// Points, quests, referral share and rank, computed ONLY from indexed chain data plus the
// signed referral bindings stored next to it. Every function here is pure: the same events and
// bindings always produce the same numbers, so a replay from deployment blocks reproduces them.
//
// Nothing here is seeded, estimated or converted to USD.

import { CHAINS, COMPLIANT_LANE, PROTOCOL, chainByIdentCode, type ChainConfig, CHAIN_LIST } from '@kakushi/config';
import type { ObservedEvent, Transfer } from './store.ts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const lower = (value: unknown): string => String(value ?? '').toLowerCase();
const chainOf = (chainId: number): ChainConfig | undefined => CHAIN_LIST.find(c => c.chainId === chainId);

// ---------------------------------------------------------------------------------------------
// Completed transfers
// ---------------------------------------------------------------------------------------------

export type Asset = 'usdc' | 'eth' | 'other';

/** A source payment that counts for points (see `isCompleted`). */
export interface CompletedTransfer {
  srcRef: string;
  sender: string;
  recipient: string;
  srcChainId: number;
  /** destination chain decoded from the ident code (last 4 digits of gross); null when unknown */
  dstChainId: number | null;
  token: string;
  asset: Asset;
  /** raw source-token units, including the ident code digits */
  gross: bigint;
  /** source block timestamp (seconds) */
  timestamp: number;
}

/**
 * A completed transfer is an indexed source payment that the sender got paid out for:
 * - `filled`: a Payout of kind 2 (fill) is joined to it;
 * - `slashed`: the sender won a dispute (Maker slashed, sender compensated);
 * - `maker-proven` / `expired` with a joined fill: a dispute was opened but ended without a slash
 *   and the fill exists, so the user was paid.
 * Refunds (Payout kind 3), pending payments, open disputes (`disputed`) and payout-only records
 * (`source-unobserved`) never count.
 */
export function isCompleted(t: Transfer): boolean {
  if (!t.source) return false;
  if (t.status === 'slashed') return true;
  const filled = t.payout !== null && String(t.payout.args.kind) === '2';
  return filled && (t.status === 'filled' || t.status === 'maker-proven' || t.status === 'expired');
}

/** Destination chain from the ident code, as the routes projection and the app decode it.
 *  9101 is the Cleanverse compliant lane, which pays out on Monad. */
export function destinationChainId(gross: bigint): number | null {
  const code = Number(gross % PROTOCOL.codeMod);
  if (code === COMPLIANT_LANE.identCode) return CHAINS[COMPLIANT_LANE.chainKey].chainId;
  return chainByIdentCode(code)?.chainId ?? null;
}

/** USDC = the chain's configured USDC; ETH = the native token on a chain whose native token is
 *  ETH (Monad's native MON is not ETH). Anything else is `other` (base points only). */
export function classifyAsset(srcChainId: number, token: string): Asset {
  const chain = chainOf(srcChainId);
  if (!chain) return 'other';
  const t = token.toLowerCase();
  if (t === chain.usdc.address.toLowerCase()) return 'usdc';
  if (t === ZERO_ADDRESS && chain.nativeSymbol === 'ETH') return 'eth';
  return 'other';
}

export function toCompleted(t: Transfer): CompletedTransfer | null {
  if (!isCompleted(t) || !t.source) return null;
  const a = t.source.args;
  const gross = BigInt(String(a.gross));
  const token = lower(a.token);
  return {
    srcRef: t.srcRef,
    sender: lower(a.sender),
    recipient: lower(a.recipient ?? a.sender),
    srcChainId: t.source.chainId,
    dstChainId: destinationChainId(gross),
    token,
    asset: classifyAsset(t.source.chainId, token),
    gross,
    timestamp: t.source.timestamp,
  };
}

// ---------------------------------------------------------------------------------------------
// Per-transfer points
// ---------------------------------------------------------------------------------------------

/** Flat points for every completed transfer. */
export const BASE_POINTS = 10;
/** Upper bound on the volume bonus of a single transfer. */
export const VOLUME_BONUS_CAP = 100;

/**
 * Volume bonus for one transfer, in whole points, from raw source units (no USD conversion):
 * - USDC: 1 point per full 10 USDC of gross (10 * 10^decimals raw units);
 * - native ETH: 1 point per full 0.005 ETH of gross (5 * 10^(decimals-3) raw units);
 * capped at VOLUME_BONUS_CAP. Other assets earn no bonus.
 */
export function volumeBonus(asset: Asset, gross: bigint, decimals: number): number {
  let step: bigint;
  if (asset === 'usdc') step = 10n * 10n ** BigInt(decimals);
  else if (asset === 'eth') step = 5n * 10n ** BigInt(decimals - 3);
  else return 0;
  const units = gross / step;
  return units >= BigInt(VOLUME_BONUS_CAP) ? VOLUME_BONUS_CAP : Number(units);
}

function decimalsOf(t: CompletedTransfer): number {
  const chain = chainOf(t.srcChainId);
  if (!chain) return 18;
  return t.asset === 'usdc' ? chain.usdc.decimals : chain.nativeDecimals;
}

export function transferPoints(t: CompletedTransfer): { base: number; volume: number } {
  return { base: BASE_POINTS, volume: volumeBonus(t.asset, t.gross, decimalsOf(t)) };
}

// ---------------------------------------------------------------------------------------------
// Profiles: everything indexed about one address
// ---------------------------------------------------------------------------------------------

export interface Profile {
  address: string;
  /** completed transfers where this address is the sender, oldest first */
  completed: CompletedTransfer[];
  /** disputes this address opened that ended in DisputeSlashed */
  disputesWon: number;
  /** a PairRegistered event names this address as Maker */
  isMaker: boolean;
  /** Payout kind 2 events emitted for this Maker */
  makerFills: number;
  referrer: string | null;
  referees: string[];
}

export interface Referral { referee: string; referrer: string }

export interface Ledger { profiles: Map<string, Profile> }

const emptyProfile = (address: string): Profile => ({ address, completed: [], disputesWon: 0, isMaker: false, makerFills: 0, referrer: null, referees: [] });

export function buildLedger(input: { transfers: Transfer[]; events: ObservedEvent[]; referrals: Referral[] }): Ledger {
  const profiles = new Map<string, Profile>();
  const get = (address: string): Profile => {
    const key = address.toLowerCase();
    let p = profiles.get(key);
    if (!p) { p = emptyProfile(key); profiles.set(key, p); }
    return p;
  };
  for (const t of input.transfers) {
    const c = toCompleted(t);
    if (c) get(c.sender).completed.push(c);
  }
  for (const p of profiles.values()) p.completed.sort((a, b) => a.timestamp - b.timestamp || a.srcRef.localeCompare(b.srcRef));
  const openers = new Map<string, string>();
  for (const e of input.events) if (e.name === 'DisputeOpened') openers.set(lower(e.args.disputeKey), lower(e.args.opener));
  for (const e of input.events) {
    if (e.name === 'DisputeSlashed') { const opener = openers.get(lower(e.args.disputeKey)); if (opener) get(opener).disputesWon++; }
    if (e.name === 'PairRegistered') get(lower(e.args.maker)).isMaker = true;
    if (e.name === 'Payout' && String(e.args.kind) === '2') get(lower(e.args.maker)).makerFills++;
  }
  for (const r of input.referrals) {
    get(r.referee).referrer = r.referrer.toLowerCase();
    get(r.referrer).referees.push(r.referee.toLowerCase());
  }
  return { profiles };
}

export const profileOf = (ledger: Ledger, address: string): Profile => ledger.profiles.get(address.toLowerCase()) ?? emptyProfile(address.toLowerCase());

/** Referees with at least one completed transfer. */
export const activeReferees = (ledger: Ledger, p: Profile): number => p.referees.filter(r => profileOf(ledger, r).completed.length > 0).length;

// ---------------------------------------------------------------------------------------------
// Quests: one-time bonuses, progress computed from the profile
// ---------------------------------------------------------------------------------------------

export type QuestCategory = 'bridge' | 'explore' | 'safety' | 'maker' | 'social';

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  points: number;
  category: QuestCategory;
  target: number;
  /** uncapped progress value */
  measure: (p: Profile, ledger: Ledger) => number;
}

const MONAD = CHAINS.monadTestnet.chainId;

/** Sum of completed USDC gross across chains, floored to whole USDC after summing raw units.
 *  Every configured USDC has 6 decimals, so raw units add up across chains. */
function usdcWhole(p: Profile): number {
  let total = 0n;
  for (const t of p.completed) if (t.asset === 'usdc') total += t.gross;
  return Number(total / 1_000_000n);
}

export const QUESTS: readonly QuestDefinition[] = [
  { id: 'first-bridge', title: 'Make your first bridge', description: 'Complete one bridge transfer.', points: 50, category: 'bridge', target: 1, measure: p => p.completed.length },
  { id: 'to-monad', title: 'Bridge to Monad', description: 'Complete a transfer whose destination is Monad.', points: 25, category: 'bridge', target: 1, measure: p => p.completed.filter(t => t.dstChainId === MONAD).length },
  { id: 'from-monad', title: 'Bridge out of Monad', description: 'Complete a transfer that starts on Monad.', points: 25, category: 'bridge', target: 1, measure: p => p.completed.filter(t => t.srcChainId === MONAD).length },
  { id: 'three-chains', title: 'Touch three chains', description: 'Use three distinct chains as source or destination of completed transfers.', points: 75, category: 'explore', target: 3, measure: p => new Set(p.completed.flatMap(t => t.dstChainId === null ? [t.srcChainId] : [t.srcChainId, t.dstChainId])).size },
  { id: 'eth-lane', title: 'Bridge native ETH', description: 'Complete a native ETH transfer.', points: 25, category: 'explore', target: 1, measure: p => p.completed.filter(t => t.asset === 'eth').length },
  { id: 'ten-transfers', title: 'Ten transfers', description: 'Complete ten bridge transfers.', points: 100, category: 'bridge', target: 10, measure: p => p.completed.length },
  { id: 'volume-100', title: 'Bridge 100 USDC', description: 'Bridge 100 USDC in total across completed transfers.', points: 100, category: 'bridge', target: 100, measure: usdcWhole },
  { id: 'custom-recipient', title: 'Send to a friend', description: 'Complete a transfer to a recipient other than yourself.', points: 25, category: 'social', target: 1, measure: p => p.completed.filter(t => t.recipient !== t.sender).length },
  { id: 'win-dispute', title: 'Win a dispute', description: 'Open a dispute that ends with the Maker slashed.', points: 150, category: 'safety', target: 1, measure: p => p.disputesWon },
  { id: 'maker-fill', title: 'Fill as a Maker', description: 'Register as a Maker and fill a transfer.', points: 200, category: 'maker', target: 1, measure: p => p.isMaker ? p.makerFills : 0 },
  { id: 'refer-friend', title: 'Refer a friend', description: 'Refer a new user who completes a transfer.', points: 50, category: 'social', target: 1, measure: (p, ledger) => activeReferees(ledger, p) },
];

export interface QuestState {
  id: string;
  title: string;
  description: string;
  points: number;
  category: QuestCategory;
  /** current is capped at target; null when no address was given */
  progress: { current: number; target: number } | null;
  completed: boolean;
}

export function questStates(ledger: Ledger, address?: string): QuestState[] {
  const p = address ? profileOf(ledger, address) : null;
  return QUESTS.map(q => {
    const value = p ? q.measure(p, ledger) : 0;
    return { id: q.id, title: q.title, description: q.description, points: q.points, category: q.category, progress: p ? { current: Math.min(value, q.target), target: q.target } : null, completed: p !== null && value >= q.target };
  });
}

// ---------------------------------------------------------------------------------------------
// Score, referral share and rank
// ---------------------------------------------------------------------------------------------

/** Referrers earn this share of each referee's transfer points (base + volume, not quests). */
export const REFERRAL_SHARE_PERCENT = 10;

/** Base + volume points of an address's own completed transfers. */
export function ownTransferPoints(p: Profile): { base: number; volume: number } {
  let base = 0, volume = 0;
  for (const t of p.completed) { const x = transferPoints(t); base += x.base; volume += x.volume; }
  return { base, volume };
}

/** floor(10% of each referee's transfer points), floored per referee, summed. All of a referee's
 *  completed transfers count: a binding is only accepted while the referee has none. */
export function referralPoints(ledger: Ledger, p: Profile): number {
  let total = 0;
  for (const r of p.referees) { const x = ownTransferPoints(profileOf(ledger, r)); total += Math.floor((x.base + x.volume) * REFERRAL_SHARE_PERCENT / 100); }
  return total;
}

export interface BreakdownItem { key: string; label: string; points: number }

export interface Score {
  address: string;
  points: number;
  transfers: number;
  breakdown: BreakdownItem[];
  referralPoints: number;
  /** timestamp of the first completed transfer, used to break rank ties */
  firstCompletedAt: number | null;
}

export function scoreOf(ledger: Ledger, address: string): Score {
  const p = profileOf(ledger, address);
  const own = ownTransferPoints(p);
  const quests = questStates(ledger, p.address).filter(q => q.completed);
  const referral = referralPoints(ledger, p);
  const breakdown: BreakdownItem[] = [
    { key: 'transfers', label: 'Completed transfers', points: own.base },
    { key: 'volume', label: 'Volume bonus', points: own.volume },
    ...quests.map(q => ({ key: `quest:${q.id}`, label: q.title, points: q.points })),
    { key: 'referral', label: 'Referral share', points: referral },
  ];
  return { address: p.address, points: breakdown.reduce((sum, b) => sum + b.points, 0), transfers: p.completed.length, breakdown, referralPoints: referral, firstCompletedAt: p.completed[0]?.timestamp ?? null };
}

export interface Ranked { rank: number; address: string; points: number; transfers: number }

/** Order: points desc, then earlier first completed transfer (none sorts last), then address asc.
 *  Addresses with 0 points are not ranked. Ranks are 1-based and unique. */
export function compareScores(a: Score, b: Score): number {
  return b.points - a.points
    || (a.firstCompletedAt ?? Number.POSITIVE_INFINITY) - (b.firstCompletedAt ?? Number.POSITIVE_INFINITY)
    || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
}

export function leaderboard(ledger: Ledger): Ranked[] {
  return [...ledger.profiles.keys()].map(address => scoreOf(ledger, address)).filter(s => s.points > 0).sort(compareScores)
    .map((s, i) => ({ rank: i + 1, address: s.address, points: s.points, transfers: s.transfers }));
}

/** GET /points body. */
export interface PointsView { address: string; points: number; rank: number | null; transfers: number; breakdown: BreakdownItem[]; referralPoints: number }

export function pointsView(ledger: Ledger, address: string): PointsView {
  const s = scoreOf(ledger, address);
  const rank = s.points > 0 ? leaderboard(ledger).find(r => r.address === s.address)?.rank ?? null : null;
  return { address: s.address, points: s.points, rank, transfers: s.transfers, breakdown: s.breakdown, referralPoints: s.referralPoints };
}

/** GET /referral body. */
export interface ReferralView { address: string; referrer: string | null; referees: number; activeReferees: number; points: number }

export function referralView(ledger: Ledger, address: string): ReferralView {
  const p = profileOf(ledger, address);
  return { address: p.address, referrer: p.referrer, referees: p.referees.length, activeReferees: activeReferees(ledger, p), points: referralPoints(ledger, p) };
}
