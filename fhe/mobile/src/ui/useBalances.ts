import { useCallback, useEffect, useState } from "react";
import { useApp } from "../state/AppState";
import { balances, describeError, reveal, type Balances } from "../lib/pay";

/** Public AUSD + MON, the encrypted cAUSD handle, and the owner-only reveal. */
export function useBalances(pollMs = 6000) {
  const app = useApp();
  const [b, setB] = useState<Balances | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<{ handle: string; value: bigint; at: number } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!app.ctx || !app.address) return;
    setLoading(true);
    try {
      setB(await balances(app.ctx, app.address));
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [app.ctx, app.address]);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs, app.version]);

  // a revealed number is only valid for the handle it was revealed from, and fades after 45 s
  useEffect(() => {
    if (revealed && b && revealed.handle !== b.handle) setRevealed(null);
  }, [b, revealed]);
  // locking (or session expiry) also hides what was revealed
  useEffect(() => {
    if (!app.wallet) setRevealed(null);
  }, [app.wallet]);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 45_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const doReveal = useCallback(async () => {
    if (!app.ctx || !b) return;
    setRevealing(true);
    setRevealErr(null);
    try {
      const handle = b.handle;
      const value = await app.withSigner((w) => reveal(app.ctx!, w.account, handle));
      setRevealed({ handle, value, at: Date.now() });
    } catch (e) {
      setRevealErr(describeError(e));
    } finally {
      setRevealing(false);
    }
  }, [app, b]);

  return { b, err, loading, load, revealed, revealing, revealErr, doReveal, hide: () => setRevealed(null) };
}
