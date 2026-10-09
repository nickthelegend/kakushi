// The Maker engine: see a payment, classify it with the hub's rules, fill or refund it through
// PayoutRouter before the deadline, and defend against disputes with PayoutInclusion proofs.
import { type Account, type Hex, encodeFunctionData, parseAbiItem, zeroAddress } from "viem";
import { CHAINS, chainById, type ChainKey } from "@kakushi/config";
import { encodeGross, net, splitCode, toHex32 } from "@kakushi/attest-core";
import { prove } from "@kakushi/attest-core/prover";
import { EvmAdapter, type IncomingPayment } from "@kakushi/adapters";
import { type Kakushi, type MakerQuote, type PairInfo, disputeModuleAbi, errText, payoutRouterAbi, prepareDispute } from "@kakushi/sdk";
import { MakerDb, type PaymentRow } from "./db.ts";

export interface EngineOptions {
  name: string;
  db: MakerDb;
  /** seconds of safety before the deadline under which the Maker refuses to start a payout */
  deadlineMarginSec?: number;
  log?: (msg: string) => void;
}

export class MakerEngine {
  readonly k: Kakushi;
  readonly account: Account;
  readonly name: string;
  readonly db: MakerDb;
  readonly adapters: Record<number, EvmAdapter> = {};
  paused = false;
  private pairsCache: { at: number; pairs: PairInfo[] } = { at: 0, pairs: [] };
  private queues = new Map<number, Promise<void>>();
  private stopped = false;
  private log: (m: string) => void;
  private deadlineMargin: bigint;
  private answering = new Set<string>();

  constructor(k: Kakushi, account: Account, opts: EngineOptions) {
    this.k = k;
    this.account = account;
    this.name = opts.name;
    this.db = opts.db;
    this.log = opts.log ?? ((m) => console.log(`[${opts.name}] ${m}`));
    this.deadlineMargin = BigInt(opts.deadlineMarginSec ?? 2);
    for (const c of k.chains) this.adapters[c.chainId] = new EvmAdapter(k, c.key, account);
  }

  get address(): Hex {
    return this.account.address;
  }

  async pairs(force = false): Promise<PairInfo[]> {
    if (force || Date.now() - this.pairsCache.at > 15_000) {
      this.pairsCache = { at: Date.now(), pairs: await this.k.pairs(this.address) };
    }
    return this.pairsCache.pairs;
  }

  // ------------------------------------------------------------------ watching

  start(): void {
    for (const c of this.k.chains) void this.watchChain(c.key);
    void this.watchDisputes();
    void this.recover();
  }

  /** After a restart: resume unpaid payments; settle rows that were in flight via the on-chain guard. */
  private async recover(): Promise<void> {
    for (const row of this.db.inFlight()) {
      const a = this.adapters[row.obligationChainId];
      if (!a) continue; // chain no longer covered by this deployment: leave the row for an operator
      const done = (await this.k.clientById(row.obligationChainId).readContract({
        address: a.payoutRouter,
        abi: payoutRouterAbi,
        functionName: "done",
        args: [this.address, row.srcRef as Hex],
      })) as boolean;
      if (done) this.db.setStatus(row.srcRef, row.kind === "FILL" ? "filled" : "refunded", { note: "confirmed on-chain after restart" });
      else this.db.setStatus(row.srcRef, "seen", { note: "retry after restart" });
    }
    for (const row of this.db.pending()) this.enqueue(row.obligationChainId, () => this.process(row.srcRef));
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) for (const row of this.db.pending()) this.enqueue(row.obligationChainId, () => this.process(row.srcRef));
  }

  stop(): void {
    this.stopped = true;
  }

  private async watchChain(key: ChainKey): Promise<void> {
    const a = this.adapters[CHAINS[key].chainId]!;
    const pollMs = CHAINS[key].finality === "monad" ? 300 : 1000;
    let cursor = this.db.cursor(a.chainId);
    while (!this.stopped) {
      try {
        const head = await a.safeHead();
        if (cursor === undefined) cursor = head + 1n;
        if (head >= cursor) {
          const to = head - cursor > 100n ? cursor + 100n : head;
          const found = await a.paymentsIn(this.address, cursor, to);
          for (const p of found) await this.onPayment(p);
          cursor = to + 1n;
          this.db.setCursor(a.chainId, cursor);
          continue;
        }
      } catch (e) {
        this.log(`watch ${CHAINS[key].shortName}: ${(e as Error).message.split("\n")[0]}`);
      }
      await sleep(pollMs);
    }
  }

  async onPayment(p: IncomingPayment): Promise<void> {
    const c = await this.k.classify(this.address, p.chainId, p.token, p.gross, p.timestamp);
    const kind = c.kind === 1 ? "FILL" : c.kind === 2 ? "REFUND" : "NONE";
    const isNew = this.db.insert({
      srcRef: toHex32(p.srcRef),
      srcChainId: p.chainId,
      txHash: p.txHash,
      logIndex: p.logIndex,
      sender: p.sender,
      token: p.token,
      gross: p.gross.toString(),
      recipient: p.recipient,
      blockNumber: p.blockNumber.toString(),
      timestamp: Number(p.timestamp),
      via: p.via,
      kind,
      expected: c.expected.toString(),
      obligationChainId: c.kind === 0 ? p.chainId : c.obligationChainId,
      seenAt: Date.now(),
    });
    if (!isNew) return; // idempotency: one srcRef is handled at most once
    const code = splitCode(p.gross).code;
    this.log(`payment ${p.txHash.slice(0, 10)} on ${chainById(p.chainId).shortName}: ${p.gross} (code ${code}) -> ${kind}`);
    if (kind === "NONE") {
      this.db.setStatus(toHex32(p.srcRef), "ignored", { note: code === 0 ? "top-up code 0000" : "no obligation" });
      return;
    }
    this.enqueue(c.obligationChainId, () => this.process(toHex32(p.srcRef)));
  }

  /** Payouts on one chain go out one at a time (nonce order); chains run in parallel. */
  private enqueue(chainId: number, fn: () => Promise<void>): void {
    const prev = this.queues.get(chainId) ?? Promise.resolve();
    this.queues.set(
      chainId,
      prev.then(fn).catch((e) => this.log(`queue ${chainId}: ${(e as Error).message}`)),
    );
  }

  async process(srcRef: string): Promise<void> {
    const row = this.db.get(srcRef);
    if (!row || (row.status !== "seen" && row.status !== "paused")) return;
    if (this.paused) {
      this.db.setStatus(srcRef, "paused", { note: "maker paused" });
      return;
    }
    const deadline = BigInt(row.timestamp) + this.k.fillWindow;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now + this.deadlineMargin > deadline) {
      // a late payout is non-compliant AND costs inventory: never fill after the deadline
      this.db.setStatus(srcRef, "missed", { note: "deadline passed before payout" });
      this.log(`missed ${srcRef.slice(0, 10)}: deadline passed`);
      return;
    }
    const chain = row.obligationChainId;
    const a = this.adapters[chain];
    if (!a) {
      // a pair may name a chain this deployment does not cover (e.g. a local stack without the optional forks)
      this.db.setStatus(srcRef, "failed", { note: `not deployed on ${chainById(chain).shortName}` });
      return;
    }
    if (!this.db.claim(srcRef)) return;
    const isFill = row.kind === "FILL";
    const c = await this.k.classify(this.address, row.srcChainId, row.token as Hex, BigInt(row.gross), BigInt(row.timestamp));
    const token = c.payToken;
    const amount = BigInt(row.expected);
    const to = (isFill ? row.recipient : row.sender) as Hex;
    const bal = await a.balance(this.address, token);
    if (bal < amount) {
      this.db.setStatus(srcRef, "failed", { note: `insufficient inventory on ${chainById(chain).shortName}` });
      this.log(`cannot pay ${srcRef.slice(0, 10)}: inventory ${bal} < ${amount}`);
      return;
    }
    try {
      const r = await a.submitPayout({ to, token, amount, srcRef: BigInt(srcRef), kind: isFill ? "fill" : "refund" });
      this.db.setStatus(srcRef, isFill ? "filled" : "refunded", { payoutTx: r.txHash, executedMs: r.executedMs });
      this.log(`${isFill ? "filled" : "refunded"} ${srcRef.slice(0, 10)} on ${chainById(chain).shortName} in ${r.executedMs} ms (${r.txHash})`);
    } catch (e) {
      const msg = errText(e);
      this.db.setStatus(srcRef, msg.includes("AlreadyPaid") ? (isFill ? "filled" : "refunded") : "failed", { note: msg.slice(0, 300) });
      this.log(`payout ${srcRef.slice(0, 10)} failed: ${msg}`);
    }
  }

  // ------------------------------------------------------------------ disputes

  private async watchDisputes(): Promise<void> {
    const hub = this.k.hub;
    let from = (await hub.getBlockNumber()) - 500n;
    if (from < 0n) from = 0n;
    const event = parseAbiItem("event DisputeOpened(bytes32 indexed disputeKey, bytes32 indexed srcRef, address indexed maker, address opener, uint64 srcChainId, bytes32 srcTxHash, uint32 logIndex)");
    while (!this.stopped) {
      try {
        const head = await hub.getBlockNumber();
        if (head >= from) {
          const to = head - from > 90n ? from + 90n : head;
          const logs = await hub.getLogs({ address: this.k.d.hub.disputeModule, event, args: { maker: this.address }, fromBlock: from, toBlock: to });
          for (const l of logs) void this.answer(l.args.disputeKey as Hex, l.args.srcRef as Hex);
          from = to + 1n;
          continue;
        }
      } catch (e) {
        this.log(`dispute watch: ${(e as Error).message.split("\n")[0]}`);
      }
      await sleep(1500);
    }
  }

  /** Answer a dispute with a PayoutInclusion proof when we did pay. */
  async answer(key: Hex, srcRef: Hex): Promise<void> {
    if (this.answering.has(key) || this.db.dispute(key)?.status === "answered") return;
    this.answering.add(key);
    try {
      const row = this.db.get(srcRef);
      if (!row || (row.status !== "filled" && row.status !== "refunded")) {
        this.db.recordDispute(key, srcRef, "unanswerable", undefined, row ? `payment status ${row.status}` : "payment unknown to this maker");
        this.log(`dispute ${key.slice(0, 10)}: no payout to prove (${row?.status ?? "unknown"})`);
        return;
      }
      const payment = rowToPayment(row, this.address);
      for (let attempt = 0; attempt < 60 && !this.stopped; attempt++) {
        const d = await this.k.dispute(key);
        if (d.status !== 1) {
          this.db.recordDispute(key, srcRef, `closed:${d.status}`);
          return;
        }
        const plan = await prepareDispute(this.k, payment, "inclusion");
        if (!plan.ready) {
          await sleep((plan.retryAfterSec ?? 5) * 1000);
          continue;
        }
        const proof = await prove("payout_inclusion", plan.inputs);
        const a = this.adapters[CHAINS.monadTestnet.chainId]!;
        void a;
        const data = encodeFunctionData({ abi: disputeModuleAbi, functionName: "answerDispute", args: [plan.claim as never, plan.payoutWindowIds[0]!, proof.proof] });
        const hub = this.k.hub;
        const gas = ((await hub.estimateGas({ account: this.account, to: this.k.d.hub.disputeModule, data })) * 12n) / 10n;
        const nonce = await hub.getTransactionCount({ address: this.address, blockTag: "pending" });
        const fees = await hub.estimateFeesPerGas();
        const raw = await this.account.signTransaction!({
          chainId: CHAINS.monadTestnet.chainId,
          to: this.k.d.hub.disputeModule,
          data,
          gas,
          nonce,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          type: "eip1559",
        });
        const hash = await hub.sendRawTransaction({ serializedTransaction: raw });
        const rc = await hub.waitForTransactionReceipt({ hash });
        this.db.recordDispute(key, srcRef, rc.status === "success" ? "answered" : "answer-reverted", hash);
        this.log(`answered dispute ${key.slice(0, 10)} with a PayoutInclusion proof (${proof.ms} ms): ${hash}`);
        return;
      }
    } catch (e) {
      this.db.recordDispute(key, srcRef, "error", undefined, (e as Error).message.slice(0, 200));
      this.log(`dispute ${key.slice(0, 10)}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      this.answering.delete(key);
    }
  }

  // ------------------------------------------------------------------ quotes

  async quote(q: { src: number; dst: number; token: Hex; amount: bigint }): Promise<MakerQuote | { error: string }> {
    const pairs = await this.pairs();
    const pair = pairs.find((p) => p.srcChainId === q.src && p.dstChainId === q.dst && p.srcToken.toLowerCase() === q.token.toLowerCase());
    if (!pair) return { error: "no pair for this route" };
    if (!this.adapters[q.src] || !this.adapters[q.dst]) return { error: "route not covered by this deployment" };
    const gross = encodeGross(q.amount, pair.identCode);
    const { principal } = splitCode(gross);
    const base = principal > pair.withholdingFee ? principal - pair.withholdingFee : 0n;
    const tradingFee = (base * pair.tradingFeeBps) / 10_000n;
    const netAmount = net(principal, pair.withholdingFee, pair.tradingFeeBps);
    const inv = await this.adapters[q.dst]!.balance(this.address, pair.dstToken);
    const m = await this.k.margin(this.address, pair.marginToken);
    let reason: string | undefined;
    if (!pair.active) reason = "pair inactive";
    else if (this.paused) reason = "maker paused";
    else if (principal < pair.minAmount) reason = `below minimum`;
    else if (principal > pair.maxAmount) reason = `above maximum`;
    else if (inv < netAmount) reason = "insufficient inventory";
    else if (m.required === null) reason = "price feed stale";
    else if (m.margin < m.required) reason = "margin below required";
    const src = chainById(q.src);
    const dst = chainById(q.dst);
    const etaMs = (src.finality === "monad" ? 600 : (src.makerConfirmations + 1) * src.blockTimeMs) + dst.blockTimeMs + 500;
    return {
      maker: this.address,
      name: this.name,
      pairId: pair.pairId,
      srcChainId: q.src,
      dstChainId: q.dst,
      srcToken: pair.srcToken,
      dstToken: pair.dstToken,
      identCode: pair.identCode,
      gross: gross.toString(),
      principal: principal.toString(),
      withholdingFee: pair.withholdingFee.toString(),
      tradingFee: tradingFee.toString(),
      net: netAmount.toString(),
      minAmount: pair.minAmount.toString(),
      maxAmount: pair.maxAmount.toString(),
      inventory: inv.toString(),
      quotable: reason === undefined,
      reason,
      etaMs,
      margin: m.margin.toString(),
      marginRequired: (m.required ?? 0n).toString(),
    };
  }
}

export function rowToPayment(row: PaymentRow, maker: Hex) {
  return {
    srcChainId: row.srcChainId,
    txHash: row.txHash as Hex,
    logIndex: row.logIndex,
    sender: row.sender as Hex,
    maker,
    token: row.token as Hex,
    gross: BigInt(row.gross),
    recipient: row.recipient as Hex,
    blockNumber: BigInt(row.blockNumber),
    timestamp: BigInt(row.timestamp),
    via: row.via as "raw-erc20" | "raw-native" | "source-router",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { zeroAddress };
