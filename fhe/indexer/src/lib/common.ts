// Shared helpers for the Kakushi Confidential handlers: ids, lazy entity creation, rollups.
import type { Account, DailyStats, EvmOnEventContext, GlobalStats, Token } from "envio";
import { TOKENS } from "../network.generated";

export type Ctx = EvmOnEventContext;
export type Mut<T> = { -readonly [K in keyof T]: T[K] };

export const ZERO = "0x0000000000000000000000000000000000000000";
export const GLOBAL_ID = "global";
export const DAY = 86_400;

export const lc = (a: string) => a.toLowerCase();
export const tokenId = (chainId: number, token: string) => `${chainId}-${lc(token)}`;
export const paymentId = (chainId: number, token: string, handle: string) => `${chainId}-${lc(token)}-${lc(handle)}`;
export const linkId = (chainId: number, token: string, id: bigint) => `${chainId}-${lc(token)}-${id}`;
export const requestId = (chainId: number, token: string, id: bigint) => `${chainId}-${lc(token)}-${id}`;
export const revealId = (chainId: number, requestId: bigint) => `${chainId}-${requestId}`;
export const unwrapId = (chainId: number, token: string, requestId: bigint) => `${chainId}-${lc(token)}-${requestId}`;
export const txId = (chainId: number, tx: string) => `${chainId}-${lc(tx)}`;
export const tokenLabel = (addr: string) => TOKENS[lc(addr)]?.symbol;

export function emptyGlobal(): Mut<GlobalStats> {
  return {
    id: GLOBAL_ID,
    payments: 0,
    pays: 0,
    payrollPayments: 0,
    linkClaims: 0,
    transfers: 0,
    uniquePayers: 0,
    accounts: 0,
    payrollRuns: 0,
    payrollRunsViaOperator: 0,
    linksCreated: 0,
    linksClaimed: 0,
    linksRefunded: 0,
    linksOpen: 0,
    linkClaimSecondsTotal: 0,
    linkClaimAvgSeconds: undefined,
    linkClaimMedianSeconds: undefined,
    requests: 0,
    requestPayAttempts: 0,
    requestsCancelled: 0,
    wraps: 0,
    unwrapsRequested: 0,
    unwrapsSettled: 0,
    publicWrapped: 0n,
    publicUnwrapped: 0n,
    publicTvl: 0n,
    reveals: 0,
    revealsFulfilled: 0,
    revealsPending: 0,
    revealsViaCre: 0,
    revealsViaRelayer: 0,
    revealCallbacksFailed: 0,
    revealLatencySecondsTotal: 0,
    revealLatencyBlocksTotal: 0,
    revealAvgLatencySeconds: undefined,
    revealAvgLatencyBlocks: undefined,
    fheOps: 0,
    fheSelects: 0,
    fheInputsVerified: 0,
    fheTrivialEncrypts: 0,
    fheRands: 0,
    lastBlock: 0,
    lastUpdatedAt: 0,
  };
}

export async function loadGlobal(ctx: Ctx, block: number, ts: number): Promise<Mut<GlobalStats>> {
  const g: Mut<GlobalStats> = { ...((await ctx.GlobalStats.get(GLOBAL_ID)) ?? emptyGlobal()) };
  g.lastBlock = Math.max(g.lastBlock, block);
  g.lastUpdatedAt = Math.max(g.lastUpdatedAt, ts);
  return g;
}

export const dayIndex = (ts: number) => Math.floor(ts / DAY);

export async function loadDaily(ctx: Ctx, chainId: number, ts: number): Promise<Mut<DailyStats>> {
  const d = dayIndex(ts);
  const id = `${chainId}-${d}`;
  const cur = await ctx.DailyStats.get(id);
  if (cur) return { ...cur };
  return {
    id,
    chainId,
    date: new Date(d * DAY * 1000).toISOString().slice(0, 10),
    dayStart: d * DAY,
    payments: 0,
    pays: 0,
    payrollPayments: 0,
    linkClaims: 0,
    transfers: 0,
    uniquePayers: 0,
    payrollRuns: 0,
    linksCreated: 0,
    linksClaimed: 0,
    linksRefunded: 0,
    requests: 0,
    requestPayAttempts: 0,
    requestsCancelled: 0,
    wraps: 0,
    publicWrapped: 0n,
    publicUnwrapped: 0n,
    reveals: 0,
    revealsFulfilled: 0,
    revealLatencySecondsTotal: 0,
    fheOps: 0,
  };
}

/** Loads (or creates) an account and bumps lastSeen. New accounts increment g.accounts. */
export async function loadAccount(ctx: Ctx, g: Mut<GlobalStats>, address: string, block: number, ts: number): Promise<Mut<Account>> {
  const id = lc(address);
  const cur = await ctx.Account.get(id);
  if (cur) return { ...cur, lastSeenBlock: Math.max(cur.lastSeenBlock, block), lastSeenAt: Math.max(cur.lastSeenAt, ts) };
  g.accounts += 1;
  return {
    id,
    paymentsSent: 0,
    paymentsReceived: 0,
    counterparties: 0,
    payrollsRun: 0,
    payrollsOperated: 0,
    payrollPaymentsReceived: 0,
    linksCreated: 0,
    linksClaimed: 0,
    linksRefunded: 0,
    requestsSent: 0,
    requestsReceived: 0,
    wraps: 0,
    unwrapsRequested: 0,
    publicWrapped: 0n,
    publicUnwrapped: 0n,
    firstSeenBlock: block,
    firstSeenAt: ts,
    lastSeenBlock: block,
    lastSeenAt: ts,
  };
}

export async function loadToken(ctx: Ctx, chainId: number, address: string): Promise<Mut<Token>> {
  const id = tokenId(chainId, address);
  const cur = await ctx.Token.get(id);
  if (cur) return { ...cur };
  const meta = TOKENS[lc(address)];
  return {
    id,
    chainId,
    address: lc(address),
    symbol: meta?.symbol ?? "cTOKEN",
    decimals: meta?.decimals ?? 6,
    underlying: meta?.underlying ?? ZERO,
    underlyingSymbol: meta?.underlyingSymbol ?? "?",
    publicWrapped: 0n,
    publicUnwrapped: 0n,
    publicTvl: 0n,
    wraps: 0,
    unwrapsRequested: 0,
    unwrapsSettled: 0,
    payments: 0,
  };
}

/** Sorted insert + median of the claim-time samples. */
export function insertSorted(samples: readonly number[], v: number): number[] {
  const out = [...samples];
  let i = out.length;
  while (i > 0 && out[i - 1]! > v) i--;
  out.splice(i, 0, v);
  return out;
}
export function median(sorted: readonly number[]): number | undefined {
  if (!sorted.length) return undefined;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}
