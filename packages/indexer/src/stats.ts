// Chain activity statistics from indexed source payments. Pure functions over `Store.transfers()`.
//
// Counting rule: a transfer is attributed to its SOURCE chain only (where the user paid the
// Maker), by the source block timestamp. Arrivals (payouts) are not counted per chain, so a
// transfer is never counted twice. Every observed source payment counts regardless of outcome
// (pending, filled, refunded or disputed); payout-only records without an observed source do not.
// Volumes are raw source-token units keyed `chainId:token` (lowercase); tokens are never added
// together or converted to USD.

import type { Transfer } from './store.ts';

export interface ChainStat { chainId: number; transfers: number; previous: number; changePct: number | null; volumeByToken: Record<string, string> }
export interface ChainStatsView { since: number; hours: number; items: ChainStat[] }
export interface OverviewView { transfers24h: number; transfersAll: number; users: number; filled: number; medianLatencyMs: number | null; volumeByToken: Record<string, string> }

const sources = (transfers: Transfer[]) => transfers.filter((t): t is Transfer & { source: NonNullable<Transfer['source']> } => t.source !== null);

function addVolume(into: Record<string, string>, t: Transfer & { source: NonNullable<Transfer['source']> }): void {
  const key = `${t.source.chainId}:${String(t.source.args.token).toLowerCase()}`;
  into[key] = (BigInt(into[key] ?? '0') + BigInt(String(t.source.args.gross))).toString();
}

/** Percentage change, one decimal; null when the previous window is empty. */
export function changePct(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Current window [since, now] vs previous window [since - hours*3600, since), by source timestamp.
 * `chainIds` lists the indexed chains; each appears even with zero transfers. Sorted by
 * transfers desc, then chainId asc.
 */
export function chainStats(transfers: Transfer[], chainIds: number[], nowSec: number, hours: number): ChainStatsView {
  const span = hours * 3600;
  const since = nowSec - span;
  const all = sources(transfers);
  const ids = [...new Set([...chainIds, ...all.map(t => t.source.chainId)])];
  const items = ids.map(chainId => {
    const own = all.filter(t => t.source.chainId === chainId);
    const current = own.filter(t => t.source.timestamp >= since && t.source.timestamp <= nowSec);
    const previous = own.filter(t => t.source.timestamp >= since - span && t.source.timestamp < since).length;
    const volumeByToken: Record<string, string> = {};
    for (const t of current) addVolume(volumeByToken, t);
    return { chainId, transfers: current.length, previous, changePct: changePct(current.length, previous), volumeByToken };
  });
  items.sort((a, b) => b.transfers - a.transfers || a.chainId - b.chainId);
  return { since, hours, items };
}

/**
 * - transfers24h / transfersAll: observed source payments (last 24 h by source timestamp / all time);
 * - users: distinct source senders, all time;
 * - filled: source payments with a joined fill payout (kind 2), whatever a later dispute decided;
 * - medianLatencyMs: lower median of source-to-fill block-timestamp latency over those fills;
 * - volumeByToken: all-time raw source gross by `chainId:token`.
 */
export function overview(transfers: Transfer[], nowSec: number): OverviewView {
  const all = sources(transfers);
  const fills = all.filter(t => t.payout !== null && String(t.payout.args.kind) === '2');
  const latencies = fills.map(t => t.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const volumeByToken: Record<string, string> = {};
  for (const t of all) addVolume(volumeByToken, t);
  return {
    transfers24h: all.filter(t => t.source.timestamp >= nowSec - 86_400 && t.source.timestamp <= nowSec).length,
    transfersAll: all.length,
    users: new Set(all.map(t => String(t.source.args.sender).toLowerCase())).size,
    filled: fills.length,
    medianLatencyMs: latencies.length ? latencies[Math.ceil(latencies.length / 2) - 1] ?? null : null,
    volumeByToken,
  };
}
