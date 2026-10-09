"use client";

import { useCallback } from "react";
import { useRuntime } from "./runtime";
import { usePoll } from "./usePoll";

/** A transfer as the Watchtower sees it (every payment to any registered Maker). */
export interface WatchedRow {
  srcRef: string;
  maker: string;
  srcChainId: number;
  txHash: string;
  sender: string;
  token: string;
  gross: string;
  recipient: string;
  timestamp: number;
  status: string;
  note: string | null;
  proofMs: number | null;
  updatedAt: number;
}

export function useWatched(ms = 4000) {
  const { cfg } = useRuntime();
  const load = useCallback(async () => {
    const r = await fetch("/api/svc/watchtower/watched");
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "the Watchtower is not reachable");
    return (await r.json()) as WatchedRow[];
  }, []);
  return usePoll(cfg ? load : null, ms, [cfg]);
}

export const ZERO = "0x0000000000000000000000000000000000000000";

export function statusPill(status: string): { tone: "lime" | "purple" | "teal" | "amber" | "red" | "neutral"; text: string } {
  switch (status) {
    case "paid":
    case "unprovable":
      return { tone: "lime", text: "Settled" };
    case "watching":
      return { tone: "teal", text: "In flight" };
    case "overdue":
      return { tone: "red", text: "Overdue" };
    case "proving":
    case "disputed":
      return { tone: "amber", text: "Proving" };
    case "slashed":
      return { tone: "purple", text: "Paid from margin" };
    case "maker-proven":
      return { tone: "lime", text: "Maker proved it" };
    case "no-obligation":
      return { tone: "neutral", text: "No obligation" };
    default:
      return { tone: "neutral", text: status };
  }
}
