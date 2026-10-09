"use client";
// Every Fhish Pay action, written once against the PayWallet interface (Privy or local fork).
// Amounts are encrypted in this tab (Zama tfhe WASM) and bound to (sender, cAUSD) before they leave.
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, parseEventLogs, parseSignature, type Abi, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FhishClient, waitForDecryption } from "@fhish/sdk";
import { payAbi } from "@/lib/abi";
import { erc20Abi, isZeroHandle, payrollBatchTypedData, permitTypedData, refToBytes32, withBuffer } from "./core";
import type { PayWallet, SentTx } from "./wallet";

export interface PayEnv {
  client: PublicClient;
  fhish: FhishClient;
  token: Hex; // cAUSD (FhishPayToken over Agora AUSD)
  ausd: Hex;
  oracle: Hex;
  chainId: number;
  network: "local" | "testnet";
  fromBlock: bigint;
}

const FRIENDLY: Record<string, string> = {
  LinkNotOpen: "This link was already claimed or refunded.",
  LinkExpired: "This link has expired.",
  LinkNotExpired: "The link has not expired yet, so it cannot be refunded.",
  BadClaimSignature: "The link key does not match this link.",
  UnauthorizedSpender: "The payroll operator is not authorized for this employer (or its authorization expired).",
  LengthMismatch: "Recipients and amounts do not line up.",
  AmountTooLarge: "Amount too large for a 64-bit encrypted value.",
  TransferFailed: "The AUSD transfer failed (balance or allowance too low).",
  NotSender: "Only the sender can refund this link.",
  PayrollRefUsed: "A payroll with this reference was already paid. Use a new reference (e.g. the next period).",
  BatchExpired: "The signed payroll batch expired before it ran. Sign it again.",
  BadEmployerSignature: "The batch was not signed by this employer, or it was changed after signing.",
  RequestNotOpen: "This request is not open: it was cancelled, it expired, or it does not exist.",
  BadPayer: "Ask someone else: the payer cannot be empty or your own address.",
  NotPayer: "Only the account this request is addressed to can pay it.",
  NotPayee: "Only the account that sent this request can cancel it.",
};

/** Turn a viem error into one readable sentence (decoded custom errors where possible). */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name) return FRIENDLY[name] ?? `Reverted: ${name}`;
    if (rev?.signature) return `Reverted with an error from another contract (${rev.signature}), e.g. the token refused the transfer.`;
    if (rev?.reason) return `Reverted: ${rev.reason}`;
    return e.shortMessage;
  }
  const m = (e as Error)?.message ?? String(e);
  return m.split("\n")[0]!;
}

async function call(env: PayEnv, wallet: PayWallet, address: Hex, abi: Abi, functionName: string, args: readonly unknown[]): Promise<SentTx> {
  let gas: bigint;
  try {
    gas = await env.client.estimateContractGas({ address, abi, functionName, args, account: wallet.address } as never);
  } catch (e) {
    throw new Error(explain(e));
  }
  const data = encodeFunctionData({ abi, functionName, args } as never);
  return wallet.send({ to: address, data, gas: withBuffer(gas) });
}
const callPay = (env: PayEnv, wallet: PayWallet, fn: string, args: readonly unknown[]) => call(env, wallet, env.token, payAbi as Abi, fn, args);

// ------------------------------------------------------------------ reads

export async function balances(env: PayEnv, who: Hex) {
  const [ausd, handle] = await Promise.all([
    env.client.readContract({ address: env.ausd, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    env.client.readContract({ address: env.token, abi: payAbi, functionName: "confidentialBalanceOf", args: [who] }),
  ]);
  return { ausd, handle: handle as Hex };
}

/** Decrypt handles this wallet may read (ACL): one EIP-712 signature, values sealed to this tab. */
export async function reveal(env: PayEnv, wallet: PayWallet, handles: Hex[]): Promise<Record<string, bigint>> {
  const hs = [...new Set(handles.filter((h) => !isZeroHandle(h)).map((h) => h.toLowerCase() as Hex))];
  if (!hs.length) return {};
  return env.fhish.userDecryptWith(hs, env.token, wallet.address, (td) => wallet.signTypedData(td as never));
}

// ------------------------------------------------------------------ onboarding

/**
 * Wrap AUSD into cAUSD.
 * Privy: approve + wrap, both gas-sponsored (no permit: an EIP-7702-upgraded account has code, and
 * tokens that check ERC-1271 first would reject a plain ECDSA permit).
 * Local: one ERC-2612 permit signature + wrapWithPermit (a single transaction).
 */
export async function wrap(env: PayEnv, wallet: PayWallet, amount: bigint, onStep?: (s: string) => void): Promise<SentTx> {
  if (wallet.kind === "local") {
    // the EIP-712 domain (EIP-5267) is not name(): AUSD's name() is "AUSD", its domain "Agora Dollar"
    const [nonce, domain] = await Promise.all([
      env.client.readContract({ address: env.ausd, abi: erc20Abi, functionName: "nonces", args: [wallet.address] }),
      env.client
        .readContract({ address: env.ausd, abi: erc20Abi, functionName: "eip712Domain" })
        .then((d) => ({ name: d[1], version: d[2] }))
        .catch(async () => ({ name: await env.client.readContract({ address: env.ausd, abi: erc20Abi, functionName: "name" }), version: "1" })),
    ]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    onStep?.("Signing an ERC-2612 permit for AUSD…");
    const sig = parseSignature(await wallet.signTypedData(permitTypedData({ chainId: env.chainId, token: env.ausd, tokenName: domain.name, tokenVersion: domain.version, owner: wallet.address, spender: env.token, value: amount, nonce, deadline })));
    onStep?.("Wrapping with the permit (one transaction)…");
    return callPay(env, wallet, "wrapWithPermit", [amount, deadline, Number(sig.v ?? BigInt(sig.yParity! + 27)), sig.r, sig.s]);
  }
  const allowance = await env.client.readContract({ address: env.ausd, abi: erc20Abi, functionName: "allowance", args: [wallet.address, env.token] });
  if (allowance < amount) {
    onStep?.("Approving AUSD (gas sponsored)…");
    await call(env, wallet, env.ausd, erc20Abi as Abi, "approve", [env.token, amount]);
  }
  onStep?.("Wrapping (gas sponsored)…");
  return callPay(env, wallet, "wrap", [amount]);
}

// ------------------------------------------------------------------ payments

export async function payPrivately(env: PayEnv, wallet: PayWallet, to: Hex, amount: bigint, ref: string, onStep?: (s: string) => void) {
  onStep?.("Encrypting the amount in this tab…");
  const enc = await env.fhish.encrypt("euint64", amount, env.token, wallet.address);
  onStep?.(`Encrypted in ${enc.ms.encrypt} ms, attested in ${enc.ms.attest} ms. Sending…`);
  return { enc, sent: await callPay(env, wallet, "pay", [to, enc.handle, enc.proof, refToBytes32(ref)]) };
}

export async function createPayLink(env: PayEnv, wallet: PayWallet, amount: bigint, days: number, onStep?: (s: string) => void) {
  const key = generatePrivateKey(); // one-time claim key: travels only in the URL fragment
  const claimKey = privateKeyToAccount(key).address;
  onStep?.("Encrypting the amount in this tab…");
  const enc = await env.fhish.encrypt("euint64", amount, env.token, wallet.address);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(days * 86400));
  onStep?.("Escrowing the encrypted amount behind a one-time key…");
  const sent = await callPay(env, wallet, "createLink", [enc.handle, enc.proof, claimKey, expiry]);
  const ev = parseEventLogs({ abi: payAbi, logs: sent.receipt.logs, eventName: "LinkCreated" })[0];
  if (!ev) throw new Error("LinkCreated event missing");
  const id = ev.args.id;
  const url = `${location.origin}/claim#id=${id}&k=${key}`;
  return { id, url, expiry, sent };
}

export async function readLink(env: PayEnv, id: bigint) {
  const [sender, claimKey, expiry, state, amount] = (await env.client.readContract({ address: env.token, abi: payAbi, functionName: "links", args: [id] })) as readonly [Hex, Hex, bigint, number, Hex];
  return { sender, claimKey, expiry, state: (["None", "Open", "Claimed", "Refunded"] as const)[state] ?? "None", amount };
}

/**
 * Claim a pay link to `wallet`. The link key signs claimDigest(id, to), so whoever submits the
 * transaction cannot redirect it. Privy: the new user's embedded wallet submits it, gas sponsored.
 * Local fork: the app's sponsor relayer (/api/sponsor) submits it for an account with no gas.
 */
export async function claimPayLink(env: PayEnv, wallet: PayWallet, id: bigint, key: Hex): Promise<SentTx> {
  const digest = (await env.client.readContract({ address: env.token, abi: payAbi, functionName: "claimDigest", args: [id, wallet.address] })) as Hex;
  const sig = await privateKeyToAccount(key).sign({ hash: digest });
  if (wallet.kind === "privy") return callPay(env, wallet, "claimLink", [id, wallet.address, sig]);
  const submittedAt = Date.now();
  const data = encodeFunctionData({ abi: payAbi, functionName: "claimLink", args: [id, wallet.address, sig] });
  const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: env.token, data }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `sponsor failed (${r.status})`);
  const receipt = await env.client.getTransactionReceipt({ hash: j.hash });
  return { hash: j.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receipt, submittedAt, receiptMs: Date.now() - submittedAt, via: "local-sponsor", sync: Boolean(j.sync) };
}

/** Cash out: burn an encrypted amount; the KMS reveals only that amount and the contract releases AUSD. */
export async function cashOut(env: PayEnv, wallet: PayWallet, amount: bigint, onStep?: (s: string) => void) {
  onStep?.("Encrypting the amount in this tab…");
  const enc = await env.fhish.encrypt("euint64", amount, env.token, wallet.address);
  onStep?.("Burning it from your encrypted balance…");
  const sent = await callPay(env, wallet, "unwrap", [enc.handle, enc.proof]);
  const ev = parseEventLogs({ abi: payAbi, logs: sent.receipt.logs, eventName: "UnwrapRequested" })[0];
  if (!ev) throw new Error("UnwrapRequested event missing");
  return {
    sent,
    requestId: ev.args.requestId,
    /** resolves with the AUSD released once the KMS callback ran (0 if the balance was too low) */
    settled: (async () => {
      await waitForDecryption(env.client, env.oracle, ev.args.requestId);
      const logs = await env.client.getContractEvents({ address: env.token, abi: payAbi, eventName: "Unwrapped", args: { requestId: ev.args.requestId }, fromBlock: sent.blockNumber });
      return (logs[0]?.args.amount as bigint | undefined) ?? 0n;
    })(),
  };
}

// ------------------------------------------------------------------ payroll

export interface PayrollRow {
  to: Hex;
  amount: bigint;
}

/** Encrypt each salary for `user` (the address that will submit the payroll transaction). */
export async function encryptSalaries(env: PayEnv, rows: PayrollRow[], user: Hex, onStep?: (s: string) => void) {
  const out: { handle: Hex; proof: Hex }[] = [];
  for (const [i, r] of rows.entries()) {
    onStep?.(`Encrypting salary ${i + 1} of ${rows.length} in this tab…`);
    const e = await env.fhish.encrypt("euint64", r.amount, env.token, user);
    out.push({ handle: e.handle, proof: e.proof });
  }
  return out;
}

export async function runPayrollDirect(env: PayEnv, wallet: PayWallet, rows: PayrollRow[], ref: string, onStep?: (s: string) => void) {
  const enc = await encryptSalaries(env, rows, wallet.address, onStep);
  onStep?.("Paying everyone in one transaction…");
  return callPay(env, wallet, "runPayroll", [rows.map((r) => r.to), enc.map((e) => e.handle), enc.map((e) => e.proof), refToBytes32(ref)]);
}

export async function operatorUntil(env: PayEnv, employer: Hex, operator: Hex): Promise<number> {
  return Number(await env.client.readContract({ address: env.token, abi: payAbi, functionName: "operatorUntil", args: [employer, operator] }));
}

export const authorizeOperator = (env: PayEnv, wallet: PayWallet, operator: Hex, until: number) => callPay(env, wallet, "setOperator", [operator, until]);

export interface OperatorRunResult {
  scheduled?: { id: string; runAt: number };
  hash?: Hex;
  blockNumber?: string;
  via?: string;
  sync?: boolean;
  receiptMs?: number;
}

/**
 * Hand an encrypted batch to the payroll operator (a Privy server wallet with a policy). The salaries
 * are encrypted here for the operator's address, so the server never sees a plaintext amount; the
 * employer signs the exact batch (EIP-712) so the server cannot alter or reuse it.
 */
export async function runPayrollViaOperator(env: PayEnv, wallet: PayWallet, operator: Hex, rows: PayrollRow[], ref: string, runAt: number | null, onStep?: (s: string) => void): Promise<OperatorRunResult> {
  const enc = await encryptSalaries(env, rows, operator, onStep);
  const refB = refToBytes32(ref);
  const deadline = BigInt(Math.floor((runAt ?? Date.now()) / 1000) + 3600);
  onStep?.("Signing the batch authorization…");
  const to = rows.map((r) => r.to);
  const amounts = enc.map((e) => e.handle);
  const signature = await wallet.signTypedData(payrollBatchTypedData({ chainId: env.chainId, token: env.token, employer: wallet.address, operator, to, amounts, ref: refB, deadline }));
  onStep?.(runAt ? "Handing the encrypted batch to the operator…" : "Operator is submitting runPayrollFrom…");
  const r = await fetch("/api/payroll/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ employer: wallet.address, to, amounts, proofs: enc.map((e) => e.proof), ref: refB, deadline: deadline.toString(), signature, runAt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `operator failed (${r.status})`);
  return j;
}

// ------------------------------------------------------------------ activity

export type ActivityKind = "received" | "sent" | "wrapped" | "cash-out" | "link-created" | "link-claimed" | "payroll-out" | "payroll-in" | "request-in" | "request-out";

export interface Activity {
  kind: ActivityKind;
  counterparty: Hex | null;
  handle: Hex;
  ref: Hex | null;
  block: bigint;
  tx: Hex;
  logIndex: number;
  publicAmount?: bigint; // wraps are public by design
}

/** Monad's eth_getLogs accepts at most 100 blocks per call. */
export const LOG_PAGE = 100n;
const LOG_WINDOW = 10_000n; // how far back the paged fallback scans
const LOG_CONCURRENCY = 6;

async function logsChunked<T>(env: PayEnv, fetcher: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await env.client.getBlockNumber();
  if (head < env.fromBlock) return [];
  if (head - env.fromBlock < LOG_PAGE) return fetcher(env.fromBlock, head);
  try {
    return await fetcher(env.fromBlock, head); // an uncapped RPC (the local fork) answers in one call
  } catch {
    // capped RPCs (Monad: 100 blocks): scan the recent window in 100-block pages, a few at a time
    const floor = head - LOG_WINDOW > env.fromBlock ? head - LOG_WINDOW : env.fromBlock;
    const pages: [bigint, bigint][] = [];
    for (let to = head; to >= floor; to -= LOG_PAGE) pages.push([to - LOG_PAGE + 1n > floor ? to - LOG_PAGE + 1n : floor, to]);
    const out: T[] = [];
    for (let i = 0; i < pages.length; i += LOG_CONCURRENCY) {
      for (const r of await Promise.all(pages.slice(i, i + LOG_CONCURRENCY).map(([f, t]) => fetcher(f, t)))) out.push(...r);
    }
    return out;
  }
}

/** Everything that touched `who` on cAUSD. Amounts stay ciphertext handles; only `who` can reveal them. */
export async function activity(env: PayEnv, who: Hex): Promise<Activity[]> {
  const ev = <N extends "ConfidentialTransfer" | "Paid" | "PayrollRun" | "LinkCreated" | "Wrapped" | "UnwrapRequested" | "Unwrapped" | "RequestPaid">(eventName: N, args: Record<string, Hex>) =>
    logsChunked(env, (fromBlock, toBlock) => env.client.getContractEvents({ address: env.token, abi: payAbi, eventName, args: args as never, fromBlock, toBlock }));
  const [tin, tout, paidIn, paidOut, runs, wraps, unreq, undone, reqPaid] = await Promise.all([
    ev("ConfidentialTransfer", { to: who }),
    ev("ConfidentialTransfer", { from: who }),
    ev("Paid", { to: who }),
    ev("Paid", { from: who }),
    ev("PayrollRun", {}), // every payroll run (incoming salaries are Paid events inside one)
    ev("Wrapped", { account: who }),
    ev("UnwrapRequested", { account: who }),
    ev("Unwrapped", { account: who }),
    ev("RequestPaid", {}), // payRequest(): the move is a ConfidentialTransfer of the same handle
  ]);
  // cash-outs are revealed publicly by the KMS (only the amount taken out): requestId -> amount
  const reqOfTx = new Map(unreq.map((u) => [u.transactionHash, (u.args as { requestId?: bigint }).requestId]));
  const released = new Map(undone.map((u) => [(u.args as { requestId?: bigint }).requestId, (u.args as { amount?: bigint }).amount]));
  const key = (l: { transactionHash: Hex | null; args: { amount?: Hex } }) => `${l.transactionHash}:${(l.args.amount ?? "").toLowerCase()}`;
  const refs = new Map<string, Hex>();
  for (const l of [...paidIn, ...paidOut] as { transactionHash: Hex | null; args: { amount?: Hex; ref?: Hex } }[]) refs.set(key(l), l.args.ref ?? ("0x" as Hex));
  const payrollTx = new Set(runs.map((r) => r.transactionHash));
  const requestMove = new Set(reqPaid.map((r) => `${r.transactionHash}:${((r.args as { sent?: Hex }).sent ?? "").toLowerCase()}`));
  const wrapAmt = new Map(wraps.map((w) => [w.transactionHash, (w.args as { amount?: bigint }).amount]));
  const out: Activity[] = [];
  for (const l of [...tin, ...tout] as { transactionHash: Hex; blockNumber: bigint; logIndex: number; args: { from?: Hex; to?: Hex; amount?: Hex } }[]) {
    const from = l.args.from!.toLowerCase();
    const to = l.args.to!.toLowerCase();
    const me = who.toLowerCase();
    const zero = "0x0000000000000000000000000000000000000000";
    const contract = env.token.toLowerCase();
    let kind: ActivityKind;
    let cp: Hex | null = null;
    if (from === zero) kind = "wrapped";
    else if (to === zero) kind = "cash-out";
    else if (to === contract && from === me) kind = "link-created";
    else if (from === contract && to === me) kind = "link-claimed";
    else if (from === me && to === me) continue;
    else if (to === me) {
      kind = payrollTx.has(l.transactionHash) ? "payroll-in" : requestMove.has(key(l)) ? "request-in" : "received";
      cp = l.args.from!;
    } else {
      kind = payrollTx.has(l.transactionHash) ? "payroll-out" : requestMove.has(key(l)) ? "request-out" : "sent";
      cp = l.args.to!;
    }
    out.push({ kind, counterparty: cp, handle: l.args.amount!, ref: refs.get(key(l)) ?? null, block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex, publicAmount: kind === "wrapped" ? wrapAmt.get(l.transactionHash) : kind === "cash-out" ? released.get(reqOfTx.get(l.transactionHash)) : undefined });
  }
  return out.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : Number(b.block - a.block)));
}

// ------------------------------------------------------------------ payment requests (encrypted invoices)
// The payee asks one payer for an encrypted amount. What is still owed (requestDue) is a ciphertext
// only the two of them can open, so even "is this paid?" is private. payRequest moves the whole
// outstanding amount, or 0 when the payer's encrypted balance is short (the request then stays open).

export interface PayRequestView {
  id: bigint;
  payee: Hex;
  payer: Hex;
  expiry: number;
  cancelled: boolean;
  /** current requestDue handle (changes after every payRequest) */
  due: Hex;
  /** the amount originally asked, as a handle (from PaymentRequested) */
  asked: Hex | null;
  ref: Hex | null;
  createdBlock: bigint | null;
  payAttempts: number;
  lastPaidBlock: bigint | null;
}

export const requestUrl = (id: bigint) => `${location.origin}/pay?request=${id}`;

/** Ask `payer` for `amount`: encrypted here, bound to (this wallet, cAUSD); only payee and payer can read it. */
export async function requestMoney(env: PayEnv, wallet: PayWallet, payer: Hex, amount: bigint, ref: string, days: number, onStep?: (s: string) => void) {
  onStep?.("Encrypting the amount in this tab…");
  const enc = await env.fhish.encrypt("euint64", amount, env.token, wallet.address);
  const now = Number((await env.client.getBlock()).timestamp); // chain time: a fork can run ahead of the wall clock
  const expiry = BigInt(Math.max(now, Math.floor(Date.now() / 1000)) + Math.round(days * 86400));
  onStep?.(`Encrypted in ${enc.ms.encrypt} ms. Sending the request…`);
  const sent = await callPay(env, wallet, "requestPayment", [payer, enc.handle, enc.proof, expiry, refToBytes32(ref)]);
  const ev = parseEventLogs({ abi: payAbi, logs: sent.receipt.logs, eventName: "PaymentRequested" })[0];
  if (!ev) throw new Error("PaymentRequested event missing");
  return { id: ev.args.id, url: requestUrl(ev.args.id), expiry, sent };
}

export async function readRequest(env: PayEnv, id: bigint) {
  const [payee, payer, expiry, cancelled, due] = (await env.client.readContract({ address: env.token, abi: payAbi, functionName: "payRequests", args: [id] })) as readonly [Hex, Hex, bigint, boolean, Hex];
  return { id, payee, payer, expiry: Number(expiry), cancelled, due, exists: !/^0x0+$/.test(payee) };
}

export const requestDue = async (env: PayEnv, id: bigint) => (await env.client.readContract({ address: env.token, abi: payAbi, functionName: "requestDue", args: [id] })) as Hex;

/** Payer only. Moves what is owed, or 0 if the encrypted balance is short; returns the old and new due handles. */
export async function payRequest(env: PayEnv, wallet: PayWallet, id: bigint, onStep?: (s: string) => void) {
  const before = await requestDue(env, id);
  onStep?.("Paying the request (the amount never leaves its ciphertext)…");
  const sent = await callPay(env, wallet, "payRequest", [id]);
  return { sent, before, after: await requestDue(env, id) };
}

export const cancelRequest = (env: PayEnv, wallet: PayWallet, id: bigint) => callPay(env, wallet, "cancelRequest", [id]);

type Ev<N extends string> = { transactionHash: Hex; blockNumber: bigint; args: N extends "PaymentRequested" ? { id: bigint; payee: Hex; payer: Hex; expiry: bigint; ref: Hex; due: Hex } : { id: bigint } };

/** Requests `who` sent (as payee) and received (as payer), newest first, with their current on-chain state. */
export async function listRequests(env: PayEnv, who: Hex, extra: bigint[] = [], mine = true): Promise<PayRequestView[]> {
  const get = <N extends "PaymentRequested" | "RequestPaid">(eventName: N, args: Record<string, unknown>) =>
    logsChunked(env, (fromBlock, toBlock) => env.client.getContractEvents({ address: env.token, abi: payAbi, eventName, args: args as never, fromBlock, toBlock })) as unknown as Promise<Ev<N>[]>;
  const [asPayee, asPayer] = mine ? await Promise.all([get("PaymentRequested", { payee: who }), get("PaymentRequested", { payer: who })]) : [[], []];
  const created = new Map<string, Ev<"PaymentRequested">>();
  for (const e of [...asPayee, ...asPayer]) created.set(e.args.id.toString(), e);
  const missing = extra.filter((id) => !created.has(id.toString()));
  if (missing.length) for (const e of await get("PaymentRequested", { id: missing })) created.set(e.args.id.toString(), e);
  const ids = [...new Set([...created.keys(), ...extra.map(String)])].map(BigInt).sort((a, b) => (a > b ? -1 : 1)).slice(0, 40);
  if (!ids.length) return [];
  const paid = await get("RequestPaid", { id: ids });
  const views = await Promise.all(ids.map((id) => readRequest(env, id)));
  return views
    .filter((v) => v.exists)
    .map((v) => {
      const c = created.get(v.id.toString());
      const p = paid.filter((x) => x.args.id === v.id);
      return {
        id: v.id,
        payee: v.payee,
        payer: v.payer,
        expiry: v.expiry,
        cancelled: v.cancelled,
        due: v.due,
        asked: c?.args.due ?? null,
        ref: c?.args.ref ?? null,
        createdBlock: c?.blockNumber ?? null,
        payAttempts: p.length,
        lastPaidBlock: p.length ? p[p.length - 1]!.blockNumber : null,
      };
    });
}
