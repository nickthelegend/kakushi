// Fhish Pay on Agora AUSD: every operation the app performs, free of React so it runs in Node too
// (scripts/verify-fork.ts drives exactly these functions against the local fork).
//
// cAUSD = FhishPayToken (contracts/src/apps/ConfidentialPayments.sol): AUSD wrapped 1:1 into an
// encrypted balance. Amounts of pay / createLink / unwrap are encrypted on this device; the chain
// stores ciphertext handles only. Only the owner can reveal their balance (EIP-712 + sealed reply).
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseSignature,
  toHex,
  type Abi,
  type LocalAccount,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Network } from "./config.ts";
import { FhishClient, type EncryptedInput, type Encryptor } from "./fhish.ts";
import { MonadHeads, sendRawSync, trackByTags, type CommitState, type CommitTimeline, type SentTx } from "./monad.ts";
import type { Hex } from "./bytes.ts";

export const payAbi = parseAbi([
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
  "function wrap(uint256 amount)",
  "function wrapWithAuthorization(address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function pay(address to, bytes32 encryptedAmount, bytes inputProof, bytes32 ref) returns (bytes32)",
  "function createLink(bytes32 encryptedAmount, bytes inputProof, address claimKey, uint64 expiry) returns (uint256)",
  "function claimDigest(uint256 id, address to) view returns (bytes32)",
  "function claimLink(uint256 id, address to, bytes signature)",
  "function refundLink(uint256 id)",
  "function links(uint256) view returns (address sender, address claimKey, uint64 expiry, uint8 state, bytes32 amount)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function unwrap(bytes32 encryptedAmount, bytes inputProof) returns (uint256)",
  "event Paid(address indexed from, address indexed to, bytes32 amount, bytes32 indexed ref)",
  "event LinkCreated(uint256 indexed id, address indexed sender, address claimKey, uint64 expiry, bytes32 amount)",
  "event LinkClaimed(uint256 indexed id, address indexed to)",
  "event LinkRefunded(uint256 indexed id)",
  "event Wrapped(address indexed account, uint256 amount)",
  "event UnwrapRequested(uint256 indexed requestId, address indexed account)",
  "event Unwrapped(uint256 indexed requestId, address indexed account, uint256 amount)",
  "function requestPayment(address payer, bytes32 encryptedAmount, bytes inputProof, uint64 expiry, bytes32 ref) returns (uint256)",
  "function payRequest(uint256 id) returns (bytes32)",
  "function cancelRequest(uint256 id)",
  "function requestDue(uint256 id) view returns (bytes32)",
  "function payRequests(uint256) view returns (address payee, address payer, uint64 expiry, bool cancelled, bytes32 due)",
  "event PaymentRequested(uint256 indexed id, address indexed payee, address indexed payer, uint64 expiry, bytes32 ref, bytes32 due)",
  "event RequestPaid(uint256 indexed id, address indexed payer, bytes32 sent)",
  "event RequestCancelled(uint256 indexed id)",
  "error AmountTooLarge()",
  "error BadClaimSignature()",
  "error FhishNotConfigured()",
  "error LinkExpired(uint256 id)",
  "error LinkNotExpired(uint256 id)",
  "error LinkNotOpen(uint256 id)",
  "error NotSender()",
  "error TransferFailed()",
  "error UnauthorizedHandle(bytes32 handle)",
  "error UnauthorizedSpender(address holder, address spender)",
  "error RequestNotOpen(uint256 id)",
  "error BadPayer()",
  "error NotPayer()",
  "error NotPayee()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function requestFunds(address to)",
]);

const oracleAbi = parseAbi(["function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)"]);

export const ZERO_HANDLE = `0x${"0".repeat(64)}` as Hex;
export const AUSD_DECIMALS = 6;

export interface PayContext {
  net: Network;
  pub: PublicClient;
  fhish: FhishClient;
  causd: Hex;
  oracle: Hex;
  /** DEV gas sponsor on the local fork (submits signature-only actions); null on testnet */
  sponsor: LocalAccount | null;
}

export function makeContext(net: Network, encryptor: Encryptor, sponsor: LocalAccount | null = null): PayContext {
  if (!net.deployment) throw new Error(`${net.label}: Fhish Pay is not deployed on this network yet`);
  const chain = defineChain({
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
  });
  const pub = createPublicClient({ chain, transport: http(net.rpcUrl, { retryCount: 1 }) }) as PublicClient;
  return {
    net,
    pub,
    fhish: new FhishClient(net.gatewayUrl, net.chainId, encryptor),
    causd: net.deployment.causd,
    oracle: net.deployment.oracle,
    sponsor: net.dev ? sponsor : null,
  };
}

// ------------------------------------------------------------------ amounts

export function parseAusd(s: string): bigint {
  const t = s.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(t)) throw new Error("Enter an amount like 25 or 12.50");
  const [i, f = ""] = t.split(".");
  const v = BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  if (v <= 0n) throw new Error("Amount must be more than 0");
  if (v > 0xffffffffffffffffn) throw new Error("Amount too large");
  return v;
}

export function formatAusd(v: bigint, opts: { min?: number } = {}): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = (a / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let f = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const min = opts.min ?? 2;
  if (f.length < min) f = f.padEnd(min, "0");
  return `${neg ? "-" : ""}${i}${f ? "." + f : ""}`;
}

export const shortHex = (h: string, n = 4) => (h.length > 2 + n * 2 ? `${h.slice(0, 2 + n)}…${h.slice(-n)}` : h);

// ------------------------------------------------------------------ errors

/** One readable line for any error (decoded custom errors where the ABI knows them). */
export function describeError(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev?.data?.errorName) {
      const n = rev.data.errorName;
      const map: Record<string, string> = {
        LinkNotOpen: "This link was already claimed or refunded.",
        LinkExpired: "This link has expired.",
        LinkNotExpired: "The link can be refunded only after it expires.",
        BadClaimSignature: "The link key does not match this link.",
        NotSender: "Only the sender can refund this link.",
        TransferFailed: "AUSD transfer failed.",
        RequestNotOpen: "This request is no longer open: it was cancelled, it expired, or it does not exist.",
        BadPayer: "Ask someone else: a request needs a payer other than yourself.",
        NotPayer: "Only the person this request was sent to can pay it.",
        NotPayee: "Only the person who sent this request can cancel it.",
      };
      return map[n] ?? `Reverted: ${n}${rev.data.args?.length ? `(${rev.data.args.join(", ")})` : ""}`;
    }
    if (/insufficient funds/i.test(e.message)) return "Not enough MON for gas on this account.";
    return e.shortMessage;
  }
  const m = e instanceof Error ? e.message : String(e);
  return m.split("\n")[0]!;
}

// ------------------------------------------------------------------ transactions

export interface TxResult extends SentTx {
  gasLimit: bigint;
  from: Hex;
}

/**
 * Sign locally and broadcast. Monad bills the gas LIMIT, so it is estimate x 1.3 (not a blanket
 * 3M); eth_sendRawTransactionSync returns the receipt in the same round trip.
 */
export async function sendTx(ctx: PayContext, account: LocalAccount, to: Hex, abi: Abi, functionName: string, args: readonly unknown[]): Promise<TxResult> {
  const from = account.address;
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const [nonce, gas, fees, bal] = await Promise.all([
    ctx.pub.getTransactionCount({ address: from, blockTag: "pending" }),
    ctx.pub.estimateContractGas({ address: to, abi, functionName, args, account: from } as never),
    ctx.pub.estimateFeesPerGas(),
    ctx.pub.getBalance({ address: from }),
  ]);
  const gasLimit = (gas * 13n) / 10n;
  if (bal < gasLimit * fees.maxFeePerGas!) throw new Error(`${shortHex(from)} has no MON for gas on ${ctx.net.label}`);
  const serialized = await account.signTransaction({
    chainId: ctx.net.chainId,
    type: "eip1559",
    to,
    data,
    nonce,
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas!,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas!,
    value: 0n,
  });
  const sent = await sendRawSync(ctx.pub, serialized as Hex);
  if (sent.status !== "success") throw new Error(`${functionName} reverted (tx ${shortHex(sent.hash)})`);
  return { ...sent, gasLimit, from };
}

/** Settlement ladder for a mined tx: Proposed -> Voted -> Finalized (-> Verified on Monad). */
export async function settle(ctx: PayContext, tx: SentTx, heads: MonadHeads | null, onState: (s: CommitState, ms: number) => void): Promise<CommitTimeline> {
  if (ctx.net.settlement === "monadHeads" && heads) {
    return heads.track(tx.blockNumber, { hash: tx.blockHash, until: "Verified", onState, startedAt: tx.submittedAt, timeoutMs: 20_000 });
  }
  return trackByTags(ctx.pub, tx.blockNumber, { onState, pollMs: 80, startedAt: tx.submittedAt });
}

// ------------------------------------------------------------------ reads

export interface Balances {
  ausd: bigint;
  mon: bigint;
  /** encrypted cAUSD balance handle (0x00.. = never held any) */
  handle: Hex;
}

export async function balances(ctx: PayContext, who: Hex): Promise<Balances> {
  const [ausd, mon, handle] = await Promise.all([
    ctx.pub.readContract({ address: ctx.net.ausd, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    ctx.pub.getBalance({ address: who }),
    ctx.pub.readContract({ address: ctx.causd, abi: payAbi, functionName: "confidentialBalanceOf", args: [who] }),
  ]);
  return { ausd, mon, handle: handle as Hex };
}

/** Reveal your own encrypted balance: sign an EIP-712 request; the reply is sealed to this device. */
export async function reveal(ctx: PayContext, account: LocalAccount, handle: Hex): Promise<bigint> {
  if (handle === ZERO_HANDLE) return 0n;
  const out = await ctx.fhish.userDecrypt([handle], ctx.causd, account.address, (td) => account.signTypedData(td as never));
  const v = out[handle.toLowerCase()];
  if (v === undefined) throw new Error("gateway returned no value for this handle");
  return v;
}

// ------------------------------------------------------------------ get AUSD, make private

/** Agora's testnet faucet: 10,000 AUSD to `to` (60 s global cooldown). The sponsor pays gas on the fork. */
export async function faucet(ctx: PayContext, account: LocalAccount, to: Hex): Promise<TxResult> {
  try {
    return await sendTx(ctx, ctx.sponsor ?? account, ctx.net.faucet, erc20Abi, "requestFunds", [to]);
  } catch (e) {
    const m = describeError(e);
    if (/revert|execution/i.test(m)) throw new Error("The AUSD faucet is cooling down (60 s, shared by everyone). Try again in a minute.");
    throw e;
  }
}

/**
 * Make AUSD private without an approve tx: sign an ERC-3009 ReceiveWithAuthorization (Agora Dollar
 * v1) that binds the exact amount and cAUSD as recipient. Anyone may submit it: the DEV sponsor on
 * the fork (gasless onboarding), the user's own account elsewhere.
 */
export async function wrapWithSignature(ctx: PayContext, account: LocalAccount, amount: bigint): Promise<TxResult & { sponsored: boolean }> {
  const from = account.address;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const rnd = new Uint8Array(32);
  crypto.getRandomValues(rnd);
  const nonce = keccak256(rnd);
  const sig = parseSignature(
    await account.signTypedData({
      domain: { name: "Agora Dollar", version: "1", chainId: ctx.net.chainId, verifyingContract: ctx.net.ausd },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: { from, to: ctx.causd, value: amount, validAfter: 0n, validBefore, nonce },
    }),
  );
  const submitter = ctx.sponsor ?? account;
  const tx = await sendTx(ctx, submitter, ctx.causd, payAbi, "wrapWithAuthorization", [from, amount, 0n, validBefore, nonce, Number(sig.v ?? BigInt(sig.yParity + 27)), sig.r, sig.s]);
  return { ...tx, sponsored: submitter !== account };
}

// ------------------------------------------------------------------ pay

export const refFromMemo = (memo: string): Hex => (memo.trim() ? keccak256(toHex(memo.trim())) : ZERO_HANDLE);

export interface Hooks {
  /** amount encrypted on device and attested by the gateway; about to sign and send */
  encrypted?(enc: EncryptedInput): void;
}

export async function pay(ctx: PayContext, account: LocalAccount, to: Hex, amount: bigint, memo = "", hooks: Hooks = {}) {
  const enc = await ctx.fhish.encrypt("euint64", amount, ctx.causd, account.address);
  hooks.encrypted?.(enc);
  const tx = await sendTx(ctx, account, ctx.causd, payAbi, "pay", [to, enc.handle, enc.proof, refFromMemo(memo)]);
  return { tx, enc };
}

// ------------------------------------------------------------------ pay links

export interface PayLink {
  id: bigint;
  /** one-time claim key: lives only inside the link */
  key: Hex;
  expiry: bigint;
}

/** Escrow an encrypted amount behind a fresh one-time key. Whoever holds the link can claim it. */
export async function createLink(ctx: PayContext, account: LocalAccount, amount: bigint, ttlSec = 7 * 86400, hooks: Hooks = {}) {
  const key = generatePrivateKey();
  const claimKey = privateKeyToAccount(key).address;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + ttlSec);
  const enc = await ctx.fhish.encrypt("euint64", amount, ctx.causd, account.address);
  hooks.encrypted?.(enc);
  const tx = await sendTx(ctx, account, ctx.causd, payAbi, "createLink", [enc.handle, enc.proof, claimKey, expiry]);
  const ev = parseEventLogs({ abi: payAbi, logs: tx.logs, eventName: "LinkCreated" })[0];
  if (!ev) throw new Error("LinkCreated not found in receipt");
  const link: PayLink = { id: ev.args.id, key, expiry };
  return { tx, enc, link };
}

export const LinkState = ["None", "Open", "Claimed", "Refunded"] as const;

export async function linkInfo(ctx: PayContext, id: bigint) {
  const [sender, claimKey, expiry, state, amount] = (await ctx.pub.readContract({ address: ctx.causd, abi: payAbi, functionName: "links", args: [id] })) as readonly [Hex, Hex, bigint, number, Hex];
  return { sender, claimKey, expiry, state: LinkState[state] ?? "None", amount };
}

/**
 * Claim link `id` to `to`: the link key signs claimDigest(id, to) (EIP-191), so a front-runner cannot
 * redirect it. The claimant needs no gas when a sponsor submits (DEV sponsor on the fork).
 */
export async function claimLink(ctx: PayContext, submitter: LocalAccount, id: bigint, key: Hex, to: Hex) {
  const info = await linkInfo(ctx, id);
  if (info.state !== "Open") throw new Error(info.state === "None" ? `Link #${id} does not exist on ${ctx.net.label}.` : `Link #${id} was already ${info.state.toLowerCase()}.`);
  const linkAccount = privateKeyToAccount(key);
  if (linkAccount.address.toLowerCase() !== info.claimKey.toLowerCase()) throw new Error("This link's key does not match link #" + id);
  if (BigInt(Math.floor(Date.now() / 1000)) > info.expiry) throw new Error("This link has expired.");
  const digest = (await ctx.pub.readContract({ address: ctx.causd, abi: payAbi, functionName: "claimDigest", args: [id, to] })) as Hex;
  const signature = await linkAccount.sign({ hash: digest });
  const by = ctx.sponsor ?? submitter;
  const tx = await sendTx(ctx, by, ctx.causd, payAbi, "claimLink", [id, to, signature]);
  // the claim re-encrypts the escrowed amount into a handle only the claimer may decrypt
  const moved = parseEventLogs({ abi: payAbi, logs: tx.logs, eventName: "ConfidentialTransfer" }).find((l) => (l.args as { to: Hex }).to.toLowerCase() === to.toLowerCase());
  return { tx, sponsored: by !== submitter, received: (moved?.args as { amount?: Hex } | undefined)?.amount ?? null };
}

export async function refundLink(ctx: PayContext, account: LocalAccount, id: bigint) {
  return sendTx(ctx, account, ctx.causd, payAbi, "refundLink", [id]);
}

// ------------------------------------------------------------------ payment requests

/**
 * Ask `payer` for an encrypted amount ("Request money"). The amount is encrypted on this device for
 * the payee (the tx sender); only the payee and the payer can ever decrypt it, or what is still owed.
 * The reference goes on-chain only as keccak256(memo); the readable memo travels in the request link.
 */
export async function requestPayment(ctx: PayContext, account: LocalAccount, payer: Hex, amount: bigint, memo = "", ttlSec = 7 * 86400, hooks: Hooks = {}) {
  const expiry = BigInt(Math.floor(Date.now() / 1000) + ttlSec);
  const ref = refFromMemo(memo);
  const enc = await ctx.fhish.encrypt("euint64", amount, ctx.causd, account.address);
  hooks.encrypted?.(enc);
  const tx = await sendTx(ctx, account, ctx.causd, payAbi, "requestPayment", [payer, enc.handle, enc.proof, expiry, ref]);
  const ev = parseEventLogs({ abi: payAbi, logs: tx.logs, eventName: "PaymentRequested" })[0];
  if (!ev) throw new Error("PaymentRequested not found in receipt");
  return { tx, enc, id: ev.args.id, expiry, ref, due: ev.args.due as Hex };
}

/**
 * Pay request `id` (payer only, from the payer's own account: it pays the gas). Moves what is still
 * owed, or nothing if the encrypted balance is short; then the request stays open with the same
 * amount owed. Which of the two happened is private: decrypt requestDue afterwards to learn it.
 */
export async function payRequest(ctx: PayContext, account: LocalAccount, id: bigint) {
  const tx = await sendTx(ctx, account, ctx.causd, payAbi, "payRequest", [id]);
  const ev = parseEventLogs({ abi: payAbi, logs: tx.logs, eventName: "RequestPaid" })[0];
  return { tx, sent: ((ev?.args as { sent?: Hex } | undefined)?.sent ?? null) as Hex | null };
}

/** Withdraw request `id` (payee only). */
export async function cancelRequest(ctx: PayContext, account: LocalAccount, id: bigint) {
  return sendTx(ctx, account, ctx.causd, payAbi, "cancelRequest", [id]);
}

export type RequestStatus = "None" | "Open" | "Cancelled" | "Expired";

export interface RequestInfo {
  id: bigint;
  payee: Hex;
  payer: Hex;
  expiry: bigint;
  cancelled: boolean;
  /** encrypted amount still owed (decryptable by payee and payer) */
  due: Hex;
  status: RequestStatus;
}

/** On-chain state of request `id`. Whether it was paid is private: reveal `due` to learn it. */
export async function requestInfo(ctx: PayContext, id: bigint): Promise<RequestInfo> {
  const [r, block] = await Promise.all([
    ctx.pub.readContract({ address: ctx.causd, abi: payAbi, functionName: "payRequests", args: [id] }) as Promise<readonly [Hex, Hex, bigint, boolean, Hex]>,
    ctx.pub.getBlock({ blockTag: "latest" }),
  ]);
  const [payee, payer, expiry, cancelled, due] = r;
  const status: RequestStatus = /^0x0{40}$/i.test(payee) ? "None" : cancelled ? "Cancelled" : block.timestamp > expiry ? "Expired" : "Open";
  return { id, payee, payer, expiry, cancelled, due, status };
}

/** The request's on-chain reference (keccak256 of the memo), read from its PaymentRequested event at `block`. */
export async function requestRef(ctx: PayContext, id: bigint, block: bigint): Promise<Hex | null> {
  const logs = await ctx.pub.getLogs({ address: ctx.causd, event: ev("PaymentRequested"), args: { id } as never, fromBlock: block, toBlock: block } as never);
  return ((logs[0] as any)?.args?.ref as Hex | undefined) ?? null;
}

/** Does `memo` (from a request link) match the reference committed on-chain? */
export const memoMatches = (memo: string, ref: Hex) => refFromMemo(memo).toLowerCase() === ref.toLowerCase();

// ------------------------------------------------------------------ cash out

/**
 * Unwrap cAUSD back to AUSD. The encrypted amount is checked against the balance homomorphically;
 * the KMS decrypts only this amount and the oracle callback (onUnwrapDecrypted) pays out AUSD.
 */
export async function unwrap(ctx: PayContext, account: LocalAccount, amount: bigint, onStage?: (s: "encrypted" | "requested" | "decrypting" | "paid", info?: unknown) => void, timeoutMs = 120_000) {
  const enc = await ctx.fhish.encrypt("euint64", amount, ctx.causd, account.address);
  onStage?.("encrypted", enc);
  const tx = await sendTx(ctx, account, ctx.causd, payAbi, "unwrap", [enc.handle, enc.proof]);
  const req = parseEventLogs({ abi: payAbi, logs: tx.logs, eventName: "UnwrapRequested" })[0];
  if (!req) throw new Error("UnwrapRequested not found in receipt");
  const requestId = req.args.requestId;
  onStage?.("requested", tx);
  onStage?.("decrypting");
  const t0 = Date.now();
  const end = t0 + timeoutMs;
  let fulfilled = false;
  while (!fulfilled && Date.now() < end) {
    const r = (await ctx.pub.readContract({ address: ctx.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] })) as readonly [Hex, Hex, boolean, Hex];
    fulfilled = r[2];
    if (!fulfilled) await new Promise((x) => setTimeout(x, 400));
  }
  if (!fulfilled) throw new Error(`Cash-out #${requestId} is still being decrypted; it will complete on its own.`);
  const logs = await ctx.pub.getLogs({ address: ctx.causd, event: payAbi.find((x) => x.type === "event" && x.name === "Unwrapped") as never, args: { requestId } as never, fromBlock: tx.blockNumber });
  const paid = (logs[0] as any)?.args?.amount as bigint | undefined;
  onStage?.("paid");
  return { tx, requestId, paid: paid ?? 0n, callbackMs: Date.now() - t0 };
}

// ------------------------------------------------------------------ activity

export type ActivityKind =
  | "sent"
  | "received"
  | "link-created"
  | "link-claimed"
  | "link-received"
  | "link-refunded"
  | "wrapped"
  | "cashout-requested"
  | "cashed-out"
  | "request-sent"
  | "request-received"
  | "request-paid"
  | "request-cancelled";

export interface ActivityItem {
  kind: ActivityKind;
  block: bigint;
  logIndex: number;
  tx: Hex;
  counterparty?: Hex;
  /** encrypted amount handle (pay / links) */
  handle?: Hex;
  /** public amount (wrap / unwrap: the AUSD side of the boundary is public by nature) */
  amount?: bigint;
  linkId?: bigint;
  ref?: Hex;
  /** payment requests: the request id and which side of it `who` is on */
  requestId?: bigint;
  role?: "payee" | "payer";
}

const ev = (name: string) => payAbi.find((x) => x.type === "event" && x.name === name) as never;

/**
 * Every cAUSD event in [from, to], paged at the network's eth_getLogs range (100 blocks on Monad) with
 * a few pages in flight. One pass over the contract's logs, filtered in memory, instead of one paged
 * scan per event and argument: activity loads in seconds instead of minutes.
 */
async function contractLogs(ctx: PayContext, from: bigint, to: bigint, concurrency = 6) {
  const pages: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += ctx.net.logRange) pages.push([a, a + ctx.net.logRange - 1n < to ? a + ctx.net.logRange - 1n : to]);
  const out: unknown[][] = new Array(pages.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
      while (next < pages.length) {
        const k = next++;
        out[k] = await ctx.pub.getLogs({ address: ctx.causd, fromBlock: pages[k]![0], toBlock: pages[k]![1] });
      }
    }),
  );
  return parseEventLogs({ abi: payAbi, logs: out.flat() as never }) as any[];
}

/** Sends and receives from on-chain events. Amounts stay ciphertext handles. */
export async function activity(ctx: PayContext, who: Hex, lookback = 200_000n): Promise<ActivityItem[]> {
  const latest = await ctx.pub.getBlockNumber();
  const deploy = BigInt(ctx.net.deployment!.deployBlock);
  const from = latest - lookback > deploy ? latest - lookback : deploy;
  const logs = await contractLogs(ctx, from, latest);
  const me = who.toLowerCase();
  const is = (a: unknown) => typeof a === "string" && a.toLowerCase() === me;
  const q = (event: string, match: (args: any) => boolean) => logs.filter((l) => l.eventName === event && match(l.args));
  const sent = q("Paid", (a) => is(a.from));
  const recv = q("Paid", (a) => is(a.to));
  const created = q("LinkCreated", (a) => is(a.sender));
  const claimedTo = q("LinkClaimed", (a) => is(a.to));
  const wrapped = q("Wrapped", (a) => is(a.account));
  const unwrapReq = q("UnwrapRequested", (a) => is(a.account));
  const unwrapped = q("Unwrapped", (a) => is(a.account));
  const asked = q("PaymentRequested", (a) => is(a.payee));
  const askedOf = q("PaymentRequested", (a) => is(a.payer));
  // claims / refunds of links I created; payments / cancellations of requests I am part of
  const myIds = new Set(created.map((l) => l.args.id as bigint));
  const role = new Map<bigint, "payee" | "payer">([...asked.map((l) => [l.args.id as bigint, "payee"] as const), ...askedOf.map((l) => [l.args.id as bigint, "payer"] as const)]);
  const claimedMine = q("LinkClaimed", (a) => myIds.has(a.id));
  const refunded = q("LinkRefunded", (a) => myIds.has(a.id));
  const reqPaid = q("RequestPaid", (a) => role.has(a.id));
  const reqCancelled = q("RequestCancelled", (a) => role.has(a.id));
  const counterparty = new Map<bigint, Hex>([...asked.map((l) => [l.args.id as bigint, l.args.payer as Hex] as const), ...askedOf.map((l) => [l.args.id as bigint, l.args.payee as Hex] as const)]);
  const base = (l: any) => ({ block: l.blockNumber as bigint, logIndex: Number(l.logIndex), tx: l.transactionHash as Hex });
  const items: ActivityItem[] = [
    ...sent.map((l) => ({ ...base(l), kind: "sent" as const, counterparty: l.args.to, handle: l.args.amount, ref: l.args.ref })),
    ...recv.filter((l) => l.args.from.toLowerCase() !== who.toLowerCase()).map((l) => ({ ...base(l), kind: "received" as const, counterparty: l.args.from, handle: l.args.amount, ref: l.args.ref })),
    ...created.map((l) => ({ ...base(l), kind: "link-created" as const, linkId: l.args.id, handle: l.args.amount })),
    ...claimedTo.map((l) => ({ ...base(l), kind: "link-received" as const, linkId: l.args.id })),
    ...claimedMine.filter((l) => l.args.to.toLowerCase() !== who.toLowerCase()).map((l) => ({ ...base(l), kind: "link-claimed" as const, linkId: l.args.id, counterparty: l.args.to })),
    ...refunded.map((l) => ({ ...base(l), kind: "link-refunded" as const, linkId: l.args.id })),
    ...wrapped.map((l) => ({ ...base(l), kind: "wrapped" as const, amount: l.args.amount })),
    ...unwrapReq.map((l) => ({ ...base(l), kind: "cashout-requested" as const })),
    ...unwrapped.map((l) => ({ ...base(l), kind: "cashed-out" as const, amount: l.args.amount })),
    ...asked.map((l) => ({ ...base(l), kind: "request-sent" as const, requestId: l.args.id, role: "payee" as const, counterparty: l.args.payer, handle: l.args.due, ref: l.args.ref })),
    ...askedOf.map((l) => ({ ...base(l), kind: "request-received" as const, requestId: l.args.id, role: "payer" as const, counterparty: l.args.payee, handle: l.args.due, ref: l.args.ref })),
    ...reqPaid.map((l) => ({ ...base(l), kind: "request-paid" as const, requestId: l.args.id, role: role.get(l.args.id), counterparty: counterparty.get(l.args.id), handle: l.args.sent })),
    ...reqCancelled.map((l) => ({ ...base(l), kind: "request-cancelled" as const, requestId: l.args.id, role: role.get(l.args.id), counterparty: counterparty.get(l.args.id) })),
  ];
  return items.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
}
