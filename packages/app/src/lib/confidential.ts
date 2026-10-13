// Kakushi Confidential (the FHE engine) flows, written once for the app and scripts/fhe-stealth-e2e.ts.
// Isomorphic: no React, no browser globals. Amounts are euint64 ciphertexts (Zama tfhe-rs); the chain
// sees handles, never numbers. The flagship combines both Kakushi engines: an encrypted amount paid to
// an ERC-5564 stealth address (ZK side hides who, FHE hides how much) through ConfidentialStealthPay.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { encodeFunctionData, getAddress, parseAbi, parseEventLogs, parseEther, type Abi, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { FHE_CONFIDENTIAL_SELECTOR, erc5564AnnouncerAbi, generateStealthAddress, type StealthMatch } from "@kakushi/sdk";
import type { KakushiFheClient } from "@kakushi/fhe-sdk";

export interface ConfidentialToken {
  key: string;
  name: string;
  symbol: string;
  address: Hex;
  underlying: Hex;
  underlyingSymbol: string;
  decimals: number;
}

/** What /api/config exposes as `fhe` (gateway is the same-origin proxy path in the browser). */
export interface FhePublicConfig {
  chainId: number;
  deployBlock: number;
  core: { registry: Hex; acl: Hex; executor: Hex; inputVerifier: Hex; oracle: Hex };
  tokens: ConfidentialToken[];
  stealthPay: Hex;
  stealthAnnouncer: Hex;
  gateway: string;
}

/** Native coin forwarded to a stealth address with a confidential payment, so it can move the funds on:
 *  the floor, on a chain with ~1 gwei gas (the local forks). See stealthGas() for the live amount. */
export const DEFAULT_STEALTH_GAS = parseEther("0.05");
/** gas limit budgeted for the stealth address's one move (confidentialTransfer: ~400k, sent as estimate x 1.3) */
const STEALTH_MOVE_GAS = 600_000n;

/** What to forward for the recipient's move at today's gas price (Monad testnet runs ~100 gwei),
 *  never below DEFAULT_STEALTH_GAS. Monad bills the whole limit, so the stealth address needs limit x price. */
export async function stealthGas(env: ConfidentialEnv): Promise<bigint> {
  const need = (STEALTH_MOVE_GAS * (await env.client.getGasPrice()) * 12n) / 10n;
  return need > DEFAULT_STEALTH_GAS ? need : DEFAULT_STEALTH_GAS;
}

export const payTokenAbi = parseAbi([
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function wrap(uint256 amount)",
  "function unwrap(bytes32 encryptedAmount, bytes inputProof) returns (uint256 requestId)",
  "function pay(address to, bytes32 encryptedAmount, bytes inputProof, bytes32 ref) returns (bytes32 sent)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function confidentialTransfer(address to, bytes32 amount) returns (bytes32)",
  "event Paid(address indexed from, address indexed to, bytes32 amount, bytes32 indexed ref)",
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
  "event UnwrapRequested(uint256 indexed requestId, address indexed account)",
  "function createLink(bytes32 encryptedAmount, bytes inputProof, address claimKey, uint64 expiry) returns (uint256 id)",
  "function claimDigest(uint256 id, address to) view returns (bytes32)",
  "function claimLink(uint256 id, address to, bytes signature)",
  "function links(uint256) view returns (address sender, address claimKey, uint64 expiry, uint8 state, bytes32 amount)",
  "event LinkCreated(uint256 indexed id, address indexed sender, address claimKey, uint64 expiry, bytes32 amount)",
  "event Unwrapped(uint256 indexed requestId, address indexed account, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const confidentialStealthPayAbi = parseAbi([
  "function pay(address token, (address stealthAddress, bytes ephemeralPubKey, bytes1 viewTag) to, bytes32 encryptedAmount, bytes inputProof) payable returns (bytes32 sent)",
]);

const oracleAbi = parseAbi(["function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)"]);

/** Anything that can send a transaction and sign EIP-712 for `address` (a wallet, or a stealth key). */
export interface ConfidentialSigner {
  address: Hex;
  sendTransaction(tx: { to: Hex; data: Hex; value?: bigint; gas: bigint; gasPrice?: bigint }): Promise<Hex>;
  signTypedData(typedData: { domain: Record<string, unknown>; types: Record<string, readonly { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>;
}

/** Adapt a viem WalletClient (with an account) to a ConfidentialSigner. */
export function walletSigner(wc: { account?: { address: Hex } | undefined; chain?: unknown; sendTransaction: (a: any) => Promise<Hex>; signTypedData: (a: any) => Promise<Hex> }): ConfidentialSigner {
  const account = wc.account;
  if (!account) throw new Error("wallet has no account");
  return {
    address: getAddress(account.address),
    sendTransaction: (tx) => wc.sendTransaction({ account, chain: wc.chain, ...tx }),
    signTypedData: (td) => wc.signTypedData({ account, ...td }),
  };
}

export interface ConfidentialEnv {
  client: PublicClient;
  fhe: KakushiFheClient;
  cfg: FhePublicConfig;
}

export const isZeroHandle = (h: Hex | null | undefined) => !h || /^0x0+$/.test(h);

/** Monad bills the gas limit: every call sends estimate x 1.3, and must succeed. The price is the live
 *  gas price + 10% rather than a wallet's 2x-base-fee cap, so an account holding exactly the gas it was
 *  sent (a stealth address) can still afford its transaction. */
async function call(env: ConfidentialEnv, s: ConfidentialSigner, to: Hex, abi: Abi, functionName: string, args: readonly unknown[], value?: bigint): Promise<TransactionReceipt> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const [est, price] = await Promise.all([env.client.estimateGas({ account: s.address, to, data, value }), env.client.getGasPrice()]);
  const hash = await s.sendTransaction({ to, data, value, gas: (est * 13n) / 10n, gasPrice: (price * 11n) / 10n });
  const rc = await env.client.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return rc;
}

export async function publicBalance(env: ConfidentialEnv, token: ConfidentialToken, who: Hex): Promise<bigint> {
  return env.client.readContract({ address: token.underlying, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

export async function balanceHandle(env: ConfidentialEnv, token: ConfidentialToken, who: Hex): Promise<Hex> {
  return env.client.readContract({ address: token.address, abi: payTokenAbi, functionName: "confidentialBalanceOf", args: [who] });
}

/** User decryption (one EIP-712 signature by `s`); values come back sealed to a key only this call holds. */
export async function reveal(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, handles: Hex[]): Promise<Record<string, bigint>> {
  const hs = [...new Set(handles.filter((h) => !isZeroHandle(h)).map((h) => h.toLowerCase() as Hex))];
  const out: Record<string, bigint> = {};
  for (const h of handles) if (isZeroHandle(h)) out[h.toLowerCase()] = 0n;
  if (!hs.length) return out;
  return { ...out, ...(await env.fhe.userDecryptWith(hs, token.address, s.address, (td) => s.signTypedData(td as never))) };
}

/** Reveal `who`'s own encrypted balance (0 when it never held any). */
export async function revealBalance(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken): Promise<bigint> {
  const h = await balanceHandle(env, token, s.address);
  return (await reveal(env, s, token, [h]))[h.toLowerCase()] ?? 0n;
}

/** Make public tokens private: approve (if needed) + wrap. The wrapped amount is public; every later move is not. */
export async function wrap(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, amount: bigint, onStep?: (m: string) => void) {
  const allowance = await env.client.readContract({ address: token.underlying, abi: erc20Abi, functionName: "allowance", args: [s.address, token.address] });
  if (allowance < amount) {
    onStep?.(`Approving ${token.underlyingSymbol}…`);
    await call(env, s, token.underlying, erc20Abi, "approve", [token.address, amount]);
  }
  onStep?.("Making it private…");
  return call(env, s, token.address, payTokenAbi, "wrap", [amount]);
}

/** Pay an encrypted amount to a known address. */
export async function payEncrypted(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, to: Hex, amount: bigint, ref: Hex, onStep?: (m: string) => void) {
  onStep?.("Encrypting the amount…");
  const enc = await env.fhe.encrypt("euint64", amount, token.address, s.address);
  onStep?.("Sending the encrypted payment…");
  const rc = await call(env, s, token.address, payTokenAbi, "pay", [to, enc.handle, enc.proof, ref]);
  const ev = parseEventLogs({ abi: payTokenAbi, logs: rc.logs, eventName: "Paid" })[0];
  return { receipt: rc, sent: (ev?.args.amount ?? null) as Hex | null, ms: enc.ms };
}

/**
 * The flagship: hide who AND how much. A fresh stealth address for `metaAddress` gets an encrypted
 * amount plus `gas` in native coin, announced on Kakushi's StealthAnnouncer with FHE metadata
 * (selector 0xfe0000fe, the confidential token, the encrypted amount's handle). One-time setup:
 * the holder lets ConfidentialStealthPay move their own balance (setOperator).
 */
export async function payStealth(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, metaAddress: string, amount: bigint, gas: bigint = DEFAULT_STEALTH_GAS, onStep?: (m: string) => void) {
  const router = env.cfg.stealthPay;
  const ok = await env.client.readContract({ address: token.address, abi: payTokenAbi, functionName: "isOperator", args: [s.address, router] });
  if (!ok) {
    onStep?.("One-time setup: allow private-recipient payments…");
    await call(env, s, token.address, payTokenAbi, "setOperator", [router, Math.floor(Date.now() / 1000) + 365 * 86400]);
  }
  onStep?.("Making a one-time address…");
  const st = generateStealthAddress(metaAddress);
  onStep?.("Encrypting the amount…");
  // the token sees the router as its caller, so the input is bound to (user = router, contract = token)
  const enc = await env.fhe.encrypt("euint64", amount, token.address, router);
  onStep?.("Sending privately…");
  const viewTag = `0x${st.viewTag.toString(16).padStart(2, "0")}` as Hex;
  const rc = await call(env, s, router, confidentialStealthPayAbi, "pay", [token.address, { stealthAddress: st.stealthAddress, ephemeralPubKey: st.ephemeralPublicKey, viewTag }, enc.handle, enc.proof], gas);
  const ann = parseEventLogs({ abi: erc5564AnnouncerAbi, logs: rc.logs, eventName: "Announcement" })[0];
  return { receipt: rc, stealthAddress: st.stealthAddress, metadata: (ann?.args.metadata ?? null) as Hex | null, gas, ms: enc.ms };
}

/** An inbox match that is a Kakushi Confidential payment in one of our tokens. */
export function confidentialMatch(m: StealthMatch, cfg: FhePublicConfig | null): (StealthMatch & { token: Hex; encryptedAmount: Hex; ctoken: ConfidentialToken }) | null {
  if (!cfg || m.kind !== "confidential" || !m.token || !m.encryptedAmount) return null;
  const ctoken = cfg.tokens.find((t) => t.address.toLowerCase() === m.token!.toLowerCase());
  return ctoken ? { ...m, token: m.token, encryptedAmount: m.encryptedAmount, ctoken } : null;
}

export { FHE_CONFIDENTIAL_SELECTOR };

/**
 * Move a stealth address's whole encrypted balance to `to` (the recipient's main wallet). The amount
 * is never decrypted: the stealth address passes its balance handle, which the token lets it use.
 */
export async function moveFromStealth(env: ConfidentialEnv, stealth: ConfidentialSigner, token: ConfidentialToken, to: Hex) {
  const h = await balanceHandle(env, token, stealth.address);
  if (isZeroHandle(h)) throw new Error("Nothing to move");
  return call(env, stealth, token.address, payTokenAbi, "confidentialTransfer", [to, h]);
}

/** Cash out: burn an encrypted amount; the KMS reveals only that amount and the token releases it. */
export async function unwrap(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, amount: bigint, onStep?: (m: string) => void, timeoutMs = 180_000) {
  onStep?.("Encrypting the amount…");
  const enc = await env.fhe.encrypt("euint64", amount, token.address, s.address);
  onStep?.("Cashing out…");
  const rc = await call(env, s, token.address, payTokenAbi, "unwrap", [enc.handle, enc.proof]);
  const ev = parseEventLogs({ abi: payTokenAbi, logs: rc.logs, eventName: "UnwrapRequested" })[0];
  if (!ev) throw new Error("UnwrapRequested missing");
  const requestId = ev.args.requestId;
  onStep?.("Waiting for the network to release it…");
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await env.client.readContract({ address: env.cfg.core.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] });
    if (r[2]) break;
    if (Date.now() > end) throw new Error(`cash-out ${requestId} not settled in ${timeoutMs / 1000} s`);
    await new Promise((x) => setTimeout(x, 500));
  }
  const logs = await env.client.getContractEvents({ address: token.address, abi: payTokenAbi, eventName: "Unwrapped", args: { requestId }, fromBlock: rc.blockNumber });
  return { receipt: rc, requestId, released: (logs[0]?.args.amount as bigint | undefined) ?? 0n };
}

// ------------------------------------------------------------------ pay links

/**
 * Escrow an encrypted amount behind a one-time claim key. The key's private half travels only in the
 * link (URL fragment); whoever holds it signs claimDigest(id, to), so a submitter cannot redirect it.
 */
export async function createPayLink(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, amount: bigint, days: number, onStep?: (m: string) => void) {
  const key = generatePrivateKey();
  onStep?.("Encrypting the amount…");
  const enc = await env.fhe.encrypt("euint64", amount, token.address, s.address);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(days * 86400));
  onStep?.("Locking it behind a one-time key…");
  const rc = await call(env, s, token.address, payTokenAbi, "createLink", [enc.handle, enc.proof, privateKeyToAccount(key).address, expiry]);
  const ev = parseEventLogs({ abi: payTokenAbi, logs: rc.logs, eventName: "LinkCreated" })[0];
  if (!ev) throw new Error("LinkCreated missing");
  return { receipt: rc, id: ev.args.id, key, expiry };
}

export const LINK_STATES = ["None", "Open", "Claimed", "Refunded"] as const;

export async function readPayLink(env: ConfidentialEnv, token: ConfidentialToken, id: bigint) {
  const [sender, claimKey, expiry, state, amount] = await env.client.readContract({ address: token.address, abi: payTokenAbi, functionName: "links", args: [id] });
  return { sender, claimKey, expiry, state: LINK_STATES[state] ?? "None", amount };
}

/** Claim a pay link into `s`'s private balance (the link key signs for `s`; `s` submits). */
export async function claimPayLink(env: ConfidentialEnv, s: ConfidentialSigner, token: ConfidentialToken, id: bigint, key: Hex) {
  const digest = await env.client.readContract({ address: token.address, abi: payTokenAbi, functionName: "claimDigest", args: [id, s.address] });
  const sig = await privateKeyToAccount(key).sign({ hash: digest });
  return call(env, s, token.address, payTokenAbi, "claimLink", [id, s.address, sig]);
}

/** `#claim=<token>.<id>.<key>`: everything after # stays in the browser (never sent to a server). */
export const payLinkFragment = (token: Hex, id: bigint, key: Hex) => `claim=${token}.${id}.${key}`;
export function parsePayLinkFragment(hash: string): { token: Hex; id: bigint; key: Hex } | null {
  const m = /claim=(0x[0-9a-fA-F]{40})\.(\d+)\.(0x[0-9a-fA-F]{64})/.exec(hash);
  return m ? { token: m[1] as Hex, id: BigInt(m[2]!), key: m[3] as Hex } : null;
}
