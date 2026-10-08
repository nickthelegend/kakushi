import {
  type Account,
  type Hex,
  type PublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  zeroAddress,
} from "viem";
import { CHAINS, type ChainKey, currentNetwork } from "@kakushi/config";
import { computeSrcRef, NATIVE_LOG_INDEX, sourceLeaf, TOPIC_PAYMENT_ENCODED, TOPIC_TRANSFER, type Leaf } from "@kakushi/attest-core";
import { erc20Abi, payoutRouterAbi, publicClient, viemChain, type Kakushi, findSourcePayment } from "@kakushi/sdk";
import type { IChainAdapter, IncomingPayment, PayoutResult, TxRequest } from "./types.ts";

const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
const topicAddr = (t: string) => `0x${t.slice(-40)}` as Hex;

export class EvmAdapter implements IChainAdapter {
  readonly vmKind = "evm" as const;
  readonly chainId: number;
  readonly finalityBlocks: number;
  readonly key: ChainKey;
  private client: PublicClient;
  private syncSupported: boolean | undefined;
  private k: Kakushi;
  private signer?: Account;

  constructor(k: Kakushi, key: ChainKey, signer?: Account) {
    this.k = k;
    this.signer = signer;
    this.key = key;
    this.chainId = CHAINS[key].chainId;
    this.finalityBlocks = k.network === "local" ? 0 : CHAINS[key].makerConfirmations;
    this.client = k.client(key);
  }

  get payoutRouter(): Hex {
    return this.k.d.chains[this.chainId]!.payoutRouter;
  }
  get sourceRouter(): Hex {
    return this.k.d.chains[this.chainId]!.sourceRouter;
  }
  get usdc(): Hex {
    return CHAINS[this.key].usdc.address;
  }

  encodePayment(to: string, token: string, amount: bigint, identCode: number): TxRequest {
    if (amount % 10_000n !== BigInt(identCode)) throw new Error(`amount ${amount} does not end in ident code ${identCode}`);
    if (token === zeroAddress) return { to, value: amount };
    return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as Hex, amount] }) };
  }

  /** The safe head: Monad testnet's finalized tag (~600 ms), or latest - N confirmations. */
  async safeHead(): Promise<bigint> {
    if (this.k.network === "testnet" && CHAINS[this.key].finality === "monad") {
      return (await this.client.getBlock({ blockTag: "finalized" })).number!;
    }
    return (await this.client.getBlockNumber()) - BigInt(this.finalityBlocks);
  }

  /** Payments to `maker` in [from, to] (USDC transfers, SourceRouter payments, native transfers). */
  async paymentsIn(maker: Hex, from: bigint, to: bigint): Promise<IncomingPayment[]> {
    const out: IncomingPayment[] = [];
    const commitState = this.k.network === "testnet" && CHAINS[this.key].finality === "monad" ? "Finalized" : "confirmed";
    const [transfers, routed] = await Promise.all([
      this.client.request({
        method: "eth_getLogs",
        params: [{ address: this.usdc, topics: [TOPIC_TRANSFER, null, pad(maker)], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      }) as Promise<any[]>,
      this.client.request({
        method: "eth_getLogs",
        params: [{ address: this.sourceRouter, topics: [TOPIC_PAYMENT_ENCODED, null, pad(maker)], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      }) as Promise<any[]>,
    ]);
    const times = new Map<bigint, bigint>();
    const ts = async (b: bigint) => {
      if (!times.has(b)) times.set(b, (await this.client.getBlock({ blockNumber: b })).timestamp);
      return times.get(b)!;
    };
    const makers = new Set((await this.k.makers()).map((m) => m.toLowerCase()));
    for (const l of transfers) {
      if (l.removed) continue;
      const sender = topicAddr(l.topics[1]);
      if (sender.toLowerCase() === this.sourceRouter.toLowerCase() || makers.has(sender.toLowerCase())) continue;
      const [gross] = decodeAbiParameters([{ type: "uint256" }], l.data);
      const blockNumber = BigInt(l.blockNumber);
      const logIndex = Number(BigInt(l.logIndex));
      out.push({ chainId: this.chainId, txHash: l.transactionHash, logIndex, srcRef: computeSrcRef(this.chainId, l.transactionHash, logIndex), sender, maker, token: this.usdc, gross, recipient: sender, blockNumber, timestamp: await ts(blockNumber), via: "raw-erc20", commitState });
    }
    for (const l of routed) {
      if (l.removed) continue;
      const [token, gross, , recipient] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint16" }, { type: "address" }], l.data);
      const blockNumber = BigInt(l.blockNumber);
      const logIndex = Number(BigInt(l.logIndex));
      out.push({ chainId: this.chainId, txHash: l.transactionHash, logIndex, srcRef: computeSrcRef(this.chainId, l.transactionHash, logIndex), sender: topicAddr(l.topics[1]), maker, token, gross, recipient, blockNumber, timestamp: await ts(blockNumber), via: "source-router", commitState });
    }
    // native transfers emit no log: scan the blocks' transactions
    for (let b = from; b <= to; b++) {
      const blk = await this.client.getBlock({ blockNumber: b, includeTransactions: true });
      for (const tx of blk.transactions) {
        if (typeof tx === "string" || !tx.to || tx.to.toLowerCase() !== maker.toLowerCase() || tx.input !== "0x" || tx.value === 0n) continue;
        if (makers.has(tx.from.toLowerCase())) continue;
        const rc = await this.client.getTransactionReceipt({ hash: tx.hash });
        if (rc.status !== "success") continue;
        times.set(b, blk.timestamp);
        out.push({ chainId: this.chainId, txHash: tx.hash, logIndex: NATIVE_LOG_INDEX, srcRef: computeSrcRef(this.chainId, tx.hash, NATIVE_LOG_INDEX), sender: tx.from, maker, token: zeroAddress, gross: tx.value, recipient: tx.from, blockNumber: b, timestamp: blk.timestamp, via: "raw-native", commitState });
      }
    }
    return out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  }

  async *watchIncoming(maker: Hex, _token?: Hex, opts: { fromBlock?: bigint; signal?: AbortSignal; pollMs?: number } = {}): AsyncIterable<IncomingPayment> {
    let cursor = opts.fromBlock ?? (await this.safeHead()) + 1n;
    const pollMs = opts.pollMs ?? (CHAINS[this.key].finality === "monad" ? 300 : 1000);
    while (!opts.signal?.aborted) {
      try {
        const head = await this.safeHead();
        if (head >= cursor) {
          const to = head - cursor > 200n ? cursor + 200n : head;
          for (const p of await this.paymentsIn(maker, cursor, to)) yield p;
          cursor = to + 1n;
          continue;
        }
      } catch {
        // transient RPC failure: retry next poll
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  async submitPayout(a: { to: Hex; token: Hex; amount: bigint; srcRef: bigint; kind: "fill" | "refund" }): Promise<PayoutResult> {
    if (!this.signer) throw new Error("adapter has no signer");
    const data = encodeFunctionData({ abi: payoutRouterAbi, functionName: a.kind, args: [`0x${a.srcRef.toString(16).padStart(64, "0")}` as Hex, a.to, a.token, a.amount] });
    const value = a.token === zeroAddress ? a.amount : 0n;
    const est = await this.client.estimateGas({ account: this.signer, to: this.payoutRouter, data, value });
    // Monad bills the gas LIMIT: tight explicit limit (estimate + 20%)
    const gas = (est * 12n) / 10n;
    const t0 = Date.now();
    const chain = viemChain(CHAINS[this.key], this.k.network);
    const nonce = await this.client.getTransactionCount({ address: this.signer.address, blockTag: "pending" });
    const fees = await this.client.estimateFeesPerGas();
    const serialized = await this.signer.signTransaction!({
      chainId: chain.id,
      to: this.payoutRouter,
      data,
      value,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      type: "eip1559",
    });
    // eth_sendRawTransactionSync (EIP-7966): one round trip to a receipt where supported (Monad)
    if (this.syncSupported !== false) {
      try {
        const rc = (await this.client.request({ method: "eth_sendRawTransactionSync" as never, params: [serialized] as never })) as any;
        this.syncSupported = true;
        if (rc.status !== "0x1") throw new Error(`payout reverted ${rc.transactionHash}`);
        return { txHash: rc.transactionHash, executedMs: Date.now() - t0, blockNumber: BigInt(rc.blockNumber) };
      } catch (e) {
        const m = (e as Error).message;
        if (/payout reverted/.test(m)) throw e;
        if (/not (found|supported|available)|does not exist|Method not found|-32601/i.test(m)) this.syncSupported = false;
        else throw e;
      }
    }
    const hash = await this.client.sendRawTransaction({ serializedTransaction: serialized });
    const rc = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 200 });
    if (rc.status !== "success") throw new Error(`payout reverted ${hash}`);
    return { txHash: hash, executedMs: Date.now() - t0, blockNumber: rc.blockNumber };
  }

  async getProofInputs(txHash: Hex): Promise<Leaf | null> {
    const p = await findSourcePayment(this.k, this.chainId, txHash);
    if (!p) return null;
    return sourceLeaf({ chainId: this.chainId, txHash, logIndex: p.logIndex, sender: p.sender, maker: p.maker, token: p.token, amount: p.gross, recipient: p.recipient, blockNumber: p.blockNumber, timestamp: p.timestamp });
  }

  async balance(owner: Hex, token: Hex): Promise<bigint> {
    if (token === zeroAddress) return this.client.getBalance({ address: owner });
    return (await this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) as bigint;
  }
}

export function localClient(key: ChainKey): PublicClient {
  return publicClient(key, currentNetwork());
}
