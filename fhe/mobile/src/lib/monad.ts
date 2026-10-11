// Monad-native settlement, adapted from sdk/src/monad.ts (@kakushi/fhe-sdk) for React Native.
//
// Monad blocks move through commit states: Proposed -> Voted (~300 ms) -> Finalized (~600 ms) ->
// Verified (state root, a few blocks later). `monadNewHeads` (WebSocket) announces each transition;
// on any other RPC (the local fork) the same states map to block tags latest / safe / finalized.
// sendRawSync uses eth_sendRawTransactionSync (EIP-7966): one round trip from signed tx to receipt.
import type { Log, PublicClient } from "viem";
import type { Hex } from "./bytes.ts";

export type CommitState = "Proposed" | "Voted" | "Finalized" | "Verified";
export const COMMIT_STATES: CommitState[] = ["Proposed", "Voted", "Finalized", "Verified"];

export interface CommitTimeline {
  block: bigint;
  /** ms since `startedAt` at which each state was first observed */
  at: Partial<Record<CommitState, number>>;
  startedAt: number;
}

export interface Head {
  number: bigint;
  hash: Hex;
  state: CommitState;
  t: number;
}
type Listener = (h: Head) => void;

/** Live commit states from Monad's `monadNewHeads` WebSocket subscription (reconnects on drop). */
export class MonadHeads {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  readonly states = new Map<bigint, { state: CommitState; hash: Hex; t: number }>();
  status: "idle" | "connecting" | "live" | "error" = "idle";
  onStatus?: (s: MonadHeads["status"]) => void;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }

  start(): void {
    this.stopped = false;
    if (this.ws) return;
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
      this.setStatus("live");
    };
    ws.onerror = () => this.setStatus("error");
    ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) {
        this.setStatus("error");
        this.retry = setTimeout(() => this.start(), 3000);
      }
    };
    ws.onmessage = (m) => {
      let j: any;
      try {
        j = JSON.parse(String(m.data));
      } catch {
        return;
      }
      const r = j?.params?.result;
      if (!r?.commitState) return;
      const h: Head = { number: BigInt(r.number), hash: r.hash as Hex, state: r.commitState as CommitState, t: Date.now() };
      const prev = this.states.get(h.number);
      if (!prev || COMMIT_STATES.indexOf(h.state) > COMMIT_STATES.indexOf(prev.state) || prev.hash !== h.hash) {
        this.states.set(h.number, { state: h.state, hash: h.hash, t: h.t });
      }
      if (this.states.size > 500) this.states.delete(this.states.keys().next().value!);
      for (const l of this.listeners) l(h);
    };
  }

  private setStatus(s: MonadHeads["status"]) {
    this.status = s;
    this.onStatus?.(s);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
    this.setStatus("idle");
  }

  /** Resolve with the timeline once `block` (with `hash`, if given) reaches `until`. */
  track(
    block: bigint,
    opts: { hash?: Hex; until?: CommitState; onState?: (s: CommitState, ms: number) => void; timeoutMs?: number; startedAt?: number } = {},
  ): Promise<CommitTimeline> {
    const until = opts.until ?? "Finalized";
    const tl: CommitTimeline = { block, at: {}, startedAt: opts.startedAt ?? Date.now() };
    return new Promise((resolve, reject) => {
      const mark = (s: CommitState, t: number) => {
        for (const e of COMMIT_STATES.slice(0, COMMIT_STATES.indexOf(s) + 1)) {
          if (tl.at[e] === undefined) {
            tl.at[e] = Math.max(0, t - tl.startedAt);
            opts.onState?.(e, tl.at[e]!);
          }
        }
        if (tl.at[until] !== undefined) {
          off();
          clearTimeout(timer);
          resolve(tl);
        }
      };
      const off = this.on((h) => {
        if (h.number > block && (h.state === "Finalized" || h.state === "Verified")) mark(h.state, h.t);
        if (h.number === block && (!opts.hash || h.hash.toLowerCase() === opts.hash.toLowerCase())) mark(h.state, h.t);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`block ${block} did not reach ${until}`));
      }, opts.timeoutMs ?? 30_000);
      const known = this.states.get(block);
      if (known && (!opts.hash || known.hash.toLowerCase() === opts.hash.toLowerCase())) mark(known.state, Date.now());
    });
  }
}

/**
 * Same timeline from block tags (any EVM RPC, including the local fork):
 * latest = Proposed, safe = Voted, finalized = Finalized.
 */
export async function trackByTags(
  client: PublicClient,
  block: bigint,
  opts: { until?: Exclude<CommitState, "Verified">; onState?: (s: CommitState, ms: number) => void; pollMs?: number; timeoutMs?: number; startedAt?: number } = {},
): Promise<CommitTimeline> {
  const until = opts.until ?? "Finalized";
  const tl: CommitTimeline = { block, at: {}, startedAt: opts.startedAt ?? Date.now() };
  const tags = [
    ["Proposed", "latest"],
    ["Voted", "safe"],
    ["Finalized", "finalized"],
  ] as const;
  const end = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < end) {
    for (const [state, tag] of tags) {
      if (tl.at[state] !== undefined) continue;
      const b = await client.getBlock({ blockTag: tag }).catch(() => null);
      if (b?.number != null && b.number >= block) {
        tl.at[state] = Date.now() - tl.startedAt;
        opts.onState?.(state, tl.at[state]!);
      }
    }
    if (tl.at[until] !== undefined) return tl;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 100));
  }
  throw new Error(`block ${block} did not reach ${until}`);
}

export interface SentTx {
  hash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  status: "success" | "reverted";
  logs: Log[];
  /** true when the RPC answered eth_sendRawTransactionSync (receipt in the same round trip) */
  sync: boolean;
  /** submit -> receipt, ms */
  ms: number;
  submittedAt: number;
}

let syncSupported: boolean | undefined;

const toLog = (l: any): Log =>
  ({
    ...l,
    blockNumber: l.blockNumber == null ? null : BigInt(l.blockNumber),
    logIndex: l.logIndex == null ? null : Number(l.logIndex),
    transactionIndex: l.transactionIndex == null ? null : Number(l.transactionIndex),
  }) as Log;

/** Broadcast a signed tx and get its receipt in one round trip where the RPC supports it (Monad, anvil >= 1.4). */
export async function sendRawSync(client: PublicClient, serialized: Hex): Promise<SentTx> {
  const t0 = Date.now();
  if (syncSupported !== false) {
    try {
      const rc = (await client.request({ method: "eth_sendRawTransactionSync" as never, params: [serialized] as never })) as {
        transactionHash: Hex;
        blockNumber: Hex;
        blockHash: Hex;
        status: Hex;
        logs: unknown[];
      };
      syncSupported = true;
      return {
        hash: rc.transactionHash,
        blockNumber: BigInt(rc.blockNumber),
        blockHash: rc.blockHash,
        status: rc.status === "0x1" ? "success" : "reverted",
        logs: (rc.logs ?? []).map(toLog),
        sync: true,
        ms: Date.now() - t0,
        submittedAt: t0,
      };
    } catch (e) {
      if (!/not (found|supported|available)|does not exist|Method not found|-32601|unsupported/i.test((e as Error).message)) throw e;
      syncSupported = false;
    }
  }
  const hash = await client.sendRawTransaction({ serializedTransaction: serialized });
  const rc = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  return { hash, blockNumber: rc.blockNumber, blockHash: rc.blockHash, status: rc.status, logs: rc.logs, sync: false, ms: Date.now() - t0, submittedAt: t0 };
}
