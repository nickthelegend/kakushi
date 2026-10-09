"use client";

import { useCallback } from "react";
import { useRuntime } from "./runtime";
import { usePoll } from "./usePoll";

/** Points, quests, leaderboard, referral and chain stats, served by the indexer from chain data. */

export interface PointsView {
  address: string;
  points: number;
  rank: number | null;
  transfers: number;
  breakdown: { key: string; label: string; points: number }[];
  referralPoints: number;
}
export interface Quest {
  id: string;
  title: string;
  description: string;
  points: number;
  category: "bridge" | "explore" | "safety" | "maker" | "social";
  progress: { current: number; target: number } | null;
  completed: boolean;
}
export interface LeaderRow {
  rank: number;
  address: string;
  points: number;
  transfers: number;
}
export interface ChainStat {
  chainId: number;
  transfers: number;
  previous: number;
  changePct: number | null;
  volumeByToken: Record<string, string>;
}
export interface Overview {
  transfers24h: number;
  transfersAll: number;
  users: number;
  filled: number;
  medianLatencyMs: number | null;
  volumeByToken: Record<string, string>;
}
export interface ReferralView {
  address: string;
  referrer: string | null;
  referees: number;
  activeReferees: number;
  points: number;
}

export function referralMessage(referrer: string, referee: string): string {
  return `Kakushi referral\nReferrer: ${referrer.toLowerCase()}\nAccount: ${referee.toLowerCase()}`;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api/svc/indexer/${path}`);
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `indexer ${r.status}`);
  return (await r.json()) as T;
}

/** Poll an indexer path while the deployment has an indexer; null path pauses. */
export function useIndexer<T>(path: string | null, ms = 8000) {
  const { cfg } = useRuntime();
  const enabled = Boolean(cfg?.services.indexer) && path !== null;
  const load = useCallback(() => getJson<T>(path!), [path]);
  const poll = usePoll(enabled ? load : null, ms, [enabled, path]);
  return { ...poll, configured: Boolean(cfg?.services.indexer), ready: Boolean(cfg) };
}

export async function bindReferral(body: { referee: string; referrer: string; signature: string }): Promise<void> {
  const r = await fetch("/api/svc/indexer/referral", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Referral could not be saved");
}
