"use client";

// Live Monad commit states from the public testnet WebSocket (read-only): each block goes
// Proposed -> Voted -> Finalized -> Verified. This is why the Kakushi hub settles disputes,
// and Makers fill Monad-source payments, about 600 ms after a block is proposed.
import { useEffect, useRef, useState } from "react";
import { cn } from "./ui";

interface Blk {
  number: number;
  proposedAt: number;
  voted?: number;
  finalized?: number;
  verified?: number;
}

const WS = "wss://testnet-rpc.monad.xyz";

export function CommitStrip({ className }: { className?: string }) {
  const [blocks, setBlocks] = useState<Blk[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "unavailable">("connecting");
  const [stats, setStats] = useState<{ voted: number; final: number; blockMs: number } | null>(null);
  const map = useRef(new Map<number, Blk>());
  const samples = useRef<{ voted: number[]; final: number[]; gaps: number[] }>({ voted: [], final: [], gaps: [] });
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let lastProposed = 0;
    const disconnect = () => {
      const socket = ws;
      ws = null;
      if (!socket) return;
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    };
    const connect = () => {
      if (closed || ws) return;
      lastProposed = 0;
      map.current.clear();
      samples.current = { voted: [], final: [], gaps: [] };
      setBlocks([]);
      setStats(null);
      setStatus("connecting");
      try {
        ws = new WebSocket(WS);
      } catch {
        setStatus("unavailable");
        return;
      }
      const socket = ws;
      socket.onopen = () => {
        if (closed || ws !== socket) return;
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
        setStatus("live");
      };
      socket.onerror = () => !closed && ws === socket && setStatus("unavailable");
      socket.onclose = () => {
        if (!closed && ws === socket) {
          ws = null;
          setStatus("unavailable");
        }
      };
      socket.onmessage = (e) => {
        if (closed || ws !== socket) return;
        const m = JSON.parse(e.data as string);
        const h = m?.params?.result;
        if (!h?.number) return;
        const n = parseInt(h.number, 16);
        const now = performance.now();
        let b = map.current.get(n);
        if (!b) {
          b = { number: n, proposedAt: now };
          map.current.set(n, b);
          if (lastProposed) samples.current.gaps.push(now - lastProposed);
          lastProposed = now;
        }
        if (h.commitState === "Voted" && !b.voted) {
          b.voted = now - b.proposedAt;
          samples.current.voted.push(b.voted);
        }
        if (h.commitState === "Finalized" && !b.finalized) {
          b.finalized = now - b.proposedAt;
          samples.current.final.push(b.finalized);
        }
        if (h.commitState === "Verified" && !b.verified) b.verified = now - b.proposedAt;
        const keys = [...map.current.keys()].sort((a, b) => b - a);
        for (const k of keys.slice(40)) map.current.delete(k);
        setBlocks(keys.slice(0, 4).map((k) => ({ ...map.current.get(k)! })));
        const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
        const s = samples.current;
        for (const k of ["voted", "final", "gaps"] as const) if (s[k].length > 60) s[k].splice(0, s[k].length - 60);
        setStats({ voted: med(s.voted), final: med(s.final), blockMs: med(s.gaps) });
      };
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) connect();
    };
    connect();
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", restore);
    return () => {
      closed = true;
      window.removeEventListener("pagehide", disconnect);
      window.removeEventListener("pageshow", restore);
      disconnect();
    };
  }, []);
  return (
    <div className={cn("rounded-[14px] border border-line bg-s1/70 p-4 backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Monad testnet, right now</span>
        <span className={cn("inline-flex items-center gap-1.5", status === "live" ? "text-ok" : status === "connecting" ? "text-muted" : "text-bad")}>
          <span className={cn("size-1.5 rounded-full", status === "live" ? "animate-pulse bg-ok" : status === "connecting" ? "bg-muted" : "bg-bad")} />
          {status === "live" ? "live" : status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => blocks[i]).map((b, i) => {
          const st = !b ? 0 : b.verified ? 4 : b.finalized ? 3 : b.voted ? 2 : 1;
          return (
            <div key={b?.number ?? i} className="rounded-[8px] border border-line p-2.5">
              <div className="font-mono text-[11px] text-muted">{b ? `…${String(b.number).slice(-4)}` : "—"}</div>
              <div className="mt-1.5 flex gap-1">
                {[1, 2, 3, 4].map((x) => (
                  <span key={x} className={cn("h-1 flex-1 rounded-full", x <= st ? (st >= 3 ? "bg-ok" : "bg-indigo") : "bg-s3")} />
                ))}
              </div>
              <div className={cn("mt-1.5 text-[11px]", st >= 3 ? "text-ok" : "text-indigo")}>
                {!b ? "" : st === 4 ? "verified" : st === 3 ? `final ${Math.round(b.finalized!)} ms` : st === 2 ? `voted ${Math.round(b.voted!)} ms` : "proposed"}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-muted">
        {stats && stats.final > 0
          ? `A block every ${Math.round(stats.blockMs)} ms, voted after ${Math.round(stats.voted)} ms and final after ${Math.round(stats.final)} ms (medians, read live via monadNewHeads).`
          : status === "unavailable"
            ? "The public Monad WebSocket is unreachable from this browser."
            : "Measuring…"}
      </div>
    </div>
  );
}
