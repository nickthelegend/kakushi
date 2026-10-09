"use client";

import { useEffect, useMemo, useState } from "react";

/** Poll an async loader; keeps the last good value and the last error. */
export function usePoll<T>(load: (() => Promise<T>) | null, ms: number, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean } {
  // The result belongs to one set of inputs. Never render the previous account's
  // balance or transfer while a replacement request is still in flight.
  const identity = useMemo(() => ({}), [load === null, ms, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<{ identity: object; data: T | null; error: string | null; loading: boolean } | null>(null);
  useEffect(() => {
    if (!load) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const data = await load();
        if (live) setResult({ identity, data, error: null, loading: false });
      } catch (e) {
        if (live) setResult((old) => ({ identity, data: old?.identity === identity ? old.data : null, error: (e as Error).message.split("\n")[0]!, loading: false }));
      } finally {
        // Schedule after completion: a slow RPC cannot overlap its next poll.
        if (live) timer = setTimeout(run, ms);
      }
    };
    void run();
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  return result?.identity === identity && load ? result : { data: null, error: null, loading: Boolean(load) };
}
