import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";
import { useApp } from "../state/AppState";
import { describeError, settle } from "../lib/pay";
import type { CommitState, SentTx } from "../lib/monad";
import type { Step } from "./Ladder";

export interface LadderState {
  at: Partial<Record<CommitState, number>>;
  sync: boolean;
  includedMs: number;
  block: bigint;
  hash: string;
}

/** Step list + settlement ladder + error state for one multi-step transaction flow. */
export function useFlow() {
  const app = useApp();
  const [steps, setSteps] = useState<Step[]>([]);
  const [ladder, setLadder] = useState<LadderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = useCallback((defs: { key: string; label: string; hint?: string }[]) => {
    setSteps(defs.map((d) => ({ ...d, state: "todo" as const })));
    setLadder(null);
    setError(null);
  }, []);

  const step = useCallback((key: string, patch: Partial<Step>) => {
    setSteps((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        return r;
      } catch (e) {
        setError(describeError(e));
        setSteps((ss) => ss.map((s) => (s.state === "active" ? { ...s, state: "error" } : s)));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** Show the settlement ladder for a mined tx and follow it to Finalized (Verified on Monad). */
  const track = useCallback(
    async (tx: SentTx) => {
      if (!app.ctx) return;
      setLadder({ at: {}, sync: tx.sync, includedMs: tx.ms, block: tx.blockNumber, hash: tx.hash });
      await settle(app.ctx, tx, app.heads, (s, ms) => setLadder((l) => (l ? { ...l, at: { ...l.at, [s]: ms } } : l))).catch(() => {});
      app.refresh();
    },
    [app],
  );

  const reset = useCallback(() => {
    setSteps([]);
    setLadder(null);
    setError(null);
  }, []);

  return { steps, ladder, error, busy, begin, step, run, track, reset, setError };
}
