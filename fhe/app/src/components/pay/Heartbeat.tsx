"use client";
// Monad heartbeat: real Monad testnet blocks moving through their commit states, live from the
// public monadNewHeads WebSocket subscription. Read-only; shown even when the app runs on a fork.
import { useEffect, useRef, useState } from "react";
import { COMMIT_STATES, type CommitState } from "@kakushi/fhe-sdk/monad";
import { acquireHeads, releaseHeads, resetHeads, MONAD_WSS } from "@/lib/pay/heads";

type Seen = Partial<Record<CommitState, number>>;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function Heartbeat({ rows = 7, compact = false }: { rows?: number; compact?: boolean }) {
  const blocks = useRef(new Map<bigint, Seen>());
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const last = useRef(0);
  const live = useRef(false);

  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    // batch re-renders (several heads arrive per 400 ms); a timer, not rAF, so it also runs in background tabs
    let raf: ReturnType<typeof setTimeout> | 0 = 0;
    const bump = () => {
      if (raf) return;
      raf = setTimeout(() => {
        raf = 0;
        if (alive) setTick((t) => t + 1);
      }, 120);
    };
    const connect = () => {
      acquireHeads()
        .then((h) => {
          if (!alive) return;
          setStatus("live");
          live.current = true;
          last.current = Date.now();
          off = h.on(({ number, state, t }) => {
            last.current = t;
            const m = blocks.current;
            const s = m.get(number) ?? {};
            if (s[state] === undefined) s[state] = t;
            m.set(number, s);
            if (m.size > 60) m.delete([...m.keys()].sort((a, b) => (a < b ? -1 : 1))[0]!);
            bump();
          });
        })
        .catch(() => {
          if (alive) setStatus("offline");
        });
    };
    connect();
    // the public socket can stall: reconnect if nothing arrived for 6 s
    const watchdog = setInterval(() => {
      if (live.current && Date.now() - last.current > 6000) {
        off?.();
        off = null;
        live.current = false;
        releaseHeads();
        resetHeads();
        setStatus("connecting");
        connect();
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(watchdog);
      if (raf) clearTimeout(raf);
      off?.();
      releaseHeads();
    };
  }, []);

  const all = [...blocks.current.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const shown = all.slice(0, rows);
  const toFinal = median(all.filter(([, s]) => s.Proposed !== undefined && s.Finalized !== undefined).map(([, s]) => s.Finalized! - s.Proposed!));
  const toVoted = median(all.filter(([, s]) => s.Proposed !== undefined && s.Voted !== undefined).map(([, s]) => s.Voted! - s.Proposed!));

  return (
    <div className="rounded-[22px] border border-kelp bg-trench/70 p-5 backdrop-blur" aria-label="Monad testnet heartbeat">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className={`inline-block size-2 rounded-full ${status === "live" ? "animate-pulse bg-sea-green" : status === "connecting" ? "bg-lantern" : "bg-reef"}`} aria-hidden />
          Monad testnet heartbeat
          <span className="font-normal text-silt">· live data</span>
        </p>
        <p className="tabular text-xs text-tide">
          {toVoted !== null && <>voted in ~{toVoted} ms · </>}
          {toFinal !== null ? <>final in ~{toFinal} ms</> : "measuring…"}
        </p>
      </div>
      {status === "offline" ? (
        <p className="mt-4 text-sm text-tide">Cannot reach {MONAD_WSS} from this browser. The ladder after each payment still works.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <caption className="sr-only">Latest Monad testnet blocks and the commit states each has reached</caption>
            <thead className="text-silt">
              <tr>
                <th className="pb-2 font-normal">Block</th>
                {COMMIT_STATES.map((s) => (
                  <th key={s} className="pb-2 font-normal">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-silt">Waiting for the first block…</td>
                </tr>
              )}
              {shown.map(([n, s]) => (
                <tr key={n.toString()} className="border-t border-kelp">
                  <td className="py-1.5 pr-3 text-tide">{n.toString()}</td>
                  {COMMIT_STATES.map((st) => {
                    const t = s[st];
                    const base = s.Proposed;
                    const on = t !== undefined;
                    return (
                      <td key={st} className="py-1.5 pr-2">
                        <span className={`inline-flex min-w-16 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors duration-300 ${on ? (st === "Finalized" || st === "Verified" ? "bg-sea-green/15 text-sea-green" : "bg-biolum-soft text-biolum") : "text-silt/60"}`}>
                          <span className={`size-1.5 rounded-full ${on ? "bg-current" : "border border-current"}`} aria-hidden />
                          {on ? (base !== undefined && st !== "Proposed" ? `+${t - base}` : "now") : "·"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && <p className="mt-3 text-xs text-silt">Straight from {MONAD_WSS} (monadNewHeads). Times are when this browser saw each state, relative to Proposed.</p>}
    </div>
  );
}
