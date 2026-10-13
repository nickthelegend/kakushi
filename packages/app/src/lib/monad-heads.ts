"use client";

import { useEffect, useState } from "react";
import { MonadHeads } from "@kakushi/fhe-sdk/monad";

/** Live Monad consensus, from the `monadNewHeads` WebSocket: the newest finalized block and how long
 *  blocks take from Proposed to Finalized (and to Verified, the state root) right now. */
export interface MonadPulse {
  finalized: bigint;
  /** median ms from a block's first sighting (Proposed) to Finalized / Verified, over recent blocks */
  finalMs: number | null;
  verifiedMs: number | null;
}

let shared: MonadHeads | null = null;

export function useMonadPulse(enabled: boolean): MonadPulse | null {
  const [pulse, setPulse] = useState<MonadPulse | null>(null);
  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    shared ??= new MonadHeads();
    const heads = shared;
    const seen = new Map<bigint, number>(); // block -> first sighting (Proposed)
    const lag: Record<"Finalized" | "Verified", number[]> = { Finalized: [], Verified: [] };
    const median = (xs: number[]) => (xs.length >= 3 ? [...xs].sort((a, b) => a - b)[xs.length >> 1]! : null);
    let finalized = 0n;
    const off = heads.on((h) => {
      if (!seen.has(h.number)) seen.set(h.number, h.t);
      if (seen.size > 300) seen.delete(seen.keys().next().value!);
      if (h.state !== "Finalized" && h.state !== "Verified") return;
      const first = seen.get(h.number);
      if (first !== undefined && first < h.t) {
        lag[h.state].push(h.t - first);
        if (lag[h.state].length > 40) lag[h.state].shift();
      }
      if (h.state === "Finalized" && h.number > finalized) finalized = h.number;
      if (finalized > 0n) setPulse({ finalized, finalMs: median(lag.Finalized), verifiedMs: median(lag.Verified) });
    });
    heads.start().catch(() => setPulse(null));
    return () => {
      off();
    };
  }, [enabled]);
  return pulse;
}
