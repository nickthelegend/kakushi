// Speculative event source for Monad: the `monadLogs` WebSocket subscription streams logs as soon as
// their block is Proposed/Voted (~0.3-1 s before Finalized). The coprocessor starts FHE work on them
// immediately; the 100-block eth_getLogs poller stays the source of truth (cursor, gaps, restarts),
// and the KMS still signs reveals only once the request block is finalized. Ops are keyed by their
// deterministic result handle, so a log seen twice (or from a block that is later dropped) is harmless.
import type { Hex, Log } from "viem";

export interface MonadLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  commitState?: string;
  removed?: boolean;
}

/** monadLogs result -> the viem Log shape the poller already handles. */
export function toViemLog(r: MonadLog): Log & { commitState?: string } {
  return {
    address: r.address,
    topics: r.topics as [Hex, ...Hex[]],
    data: r.data,
    blockNumber: BigInt(r.blockNumber),
    blockHash: r.blockHash,
    transactionHash: r.transactionHash,
    transactionIndex: Number(BigInt(r.transactionIndex)),
    logIndex: Number(BigInt(r.logIndex)),
    removed: Boolean(r.removed),
    commitState: r.commitState,
  } as Log & { commitState?: string };
}

/** Subscribe; reconnects with backoff. Returns a stop function. */
export function subscribeMonadLogs(url: string, addresses: Hex[], onLog: (l: Log & { commitState?: string }) => void, log: (m: string) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 500;
  const seen = new Set<string>();
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500;
      ws!.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadLogs", { address: addresses }] }));
      log(`monadLogs: subscribed on ${url} (speculative, from Proposed)`);
    };
    ws.onmessage = (m) => {
      const r = JSON.parse(String(m.data))?.params?.result as MonadLog | undefined;
      if (!r?.transactionHash || r.removed) return;
      const key = `${r.transactionHash}:${r.logIndex}`;
      if (seen.has(key)) return; // the same log arrives once per commit state
      seen.add(key);
      if (seen.size > 20_000) seen.clear();
      onLog(toViemLog(r));
    };
    ws.onclose = () => {
      if (stopped) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
    ws.onerror = () => ws?.close();
  };
  connect();
  return () => {
    stopped = true;
    ws?.close();
  };
}
