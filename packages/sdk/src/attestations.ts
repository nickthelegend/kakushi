// Reading CRE attestation windows from the hub and rebuilding their trees from chain data,
// so anyone (Watchtower, Sender's browser, Maker) can derive witnesses and check that the
// rebuilt root equals the attested one.
import type { Hex, PublicClient } from "viem";
import {
  type AttestWindow,
  buildChainWindows,
  type ChainAttestConfig,
  nativeSourceWindow,
  type RawLog,
  SortedTree,
  WINDOW_PAYOUT,
  WINDOW_SOURCE,
  windowLogFilters,
} from "@kakushi/attest-core";
import { attestationOracleAbi, ebcAbi } from "./abi.ts";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export interface IndexedWindow extends AttestWindow {
  id: number;
}

export async function windowCount(hub: PublicClient, oracle: Hex): Promise<number> {
  return Number(await hub.readContract({ address: oracle, abi: attestationOracleAbi, functionName: "windowCount" }));
}

/** Read windows [fromId, toId] (1-based, inclusive) with Multicall3 batches. */
export async function readWindows(hub: PublicClient, oracle: Hex, fromId: number, toId: number): Promise<IndexedWindow[]> {
  const out: IndexedWindow[] = [];
  for (let start = fromId; start <= toId; start += 100) {
    const ids = Array.from({ length: Math.min(100, toId - start + 1) }, (_, i) => start + i);
    const res = await hub.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: false,
      contracts: ids.map((id) => ({ address: oracle, abi: attestationOracleAbi, functionName: "getWindow" as const, args: [BigInt(id)] as const })),
    });
    res.forEach((w, i) => {
      const ww = w as unknown as AttestWindow;
      out.push({ ...ww, kind: Number(ww.kind), leafCount: Number(ww.leafCount), id: ids[i]! });
    });
  }
  return out;
}

/**
 * Scan windows backwards from the newest until `untilTime` is passed for `chainId`
 * (disputes concern recent transfers, so the scan is short).
 */
export async function recentWindows(hub: PublicClient, oracle: Hex, chainId: number, untilTime: bigint, maxScan = 2000): Promise<IndexedWindow[]> {
  const n = await windowCount(hub, oracle);
  const found: IndexedWindow[] = [];
  let hi = n;
  while (hi >= 1 && n - hi < maxScan) {
    const lo = Math.max(1, hi - 99);
    const batch = await readWindows(hub, oracle, lo, hi);
    let passed = false;
    for (const w of batch.reverse()) {
      if (Number(w.chainId) !== chainId) continue;
      found.push(w);
      if (w.toTime < untilTime) passed = true;
    }
    if (passed) break;
    hi = lo - 1;
  }
  return found.sort((a, b) => a.id - b.id);
}

/**
 * Choose contiguous PAYOUT windows on `chainId` covering [srcTime - skew, deadline]
 * (the same rule DisputeModule._fillWindows enforces). Returns null if not covered yet.
 */
export function coveringPayoutWindows(windows: IndexedWindow[], chainId: number, srcTime: bigint, skew: bigint, deadline: bigint, max = 8): IndexedWindow[] | null {
  const pw = windows.filter((w) => w.kind === WINDOW_PAYOUT && Number(w.chainId) === chainId).sort((a, b) => (a.fromBlock < b.fromBlock ? -1 : 1));
  const start = srcTime > skew ? srcTime - skew : 0n;
  // the last window whose fromTime <= start
  let first = -1;
  for (let i = 0; i < pw.length; i++) if (pw[i]!.fromTime <= start) first = i;
  if (first < 0) return null;
  const chosen: IndexedWindow[] = [pw[first]!];
  let i = first;
  while (chosen[chosen.length - 1]!.toTime < deadline) {
    const next = pw[i + 1];
    if (!next || next.fromBlock !== chosen[chosen.length - 1]!.toBlock + 1n) return null;
    chosen.push(next);
    i++;
    if (chosen.length > max) return null;
  }
  return chosen;
}

/** Makers known to the hub. */
export async function allMakers(hub: PublicClient, ebc: Hex): Promise<Hex[]> {
  return (await hub.readContract({ address: ebc, abi: ebcAbi, functionName: "allMakers" })) as Hex[];
}

export interface ChainCtx {
  client: PublicClient;
  cfg: ChainAttestConfig;
}

async function fetchLogs(ctx: ChainCtx, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  for (const f of windowLogFilters(ctx.cfg)) {
    const logs = await ctx.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: f.address,
          topics: f.topics as (Hex | Hex[] | null)[],
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
        },
      ],
    });
    for (const l of logs as any[]) {
      if (l.removed) continue;
      out.push({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: BigInt(l.blockNumber),
        transactionHash: l.transactionHash,
        logIndex: Number(BigInt(l.logIndex)),
      });
    }
  }
  return out;
}

async function blockTimes(client: PublicClient, blocks: bigint[]): Promise<Map<bigint, bigint>> {
  const m = new Map<bigint, bigint>();
  await Promise.all(
    [...new Set(blocks)].map(async (b) => {
      const blk = await client.getBlock({ blockNumber: b });
      m.set(b, blk.timestamp);
    }),
  );
  return m;
}

/**
 * Rebuild an attested window's sorted tree from chain data and check its root.
 * Throws if the rebuilt root differs (data unavailable or attester disagreement).
 */
export async function rebuildWindow(ctx: ChainCtx, w: AttestWindow): Promise<SortedTree> {
  if (w.kind === WINDOW_SOURCE && w.fromBlock === w.toBlock && w.leafCount === 1) {
    // maybe a single native-transfer attestation (kakushi-source-native)
    const t = await rebuildNative(ctx, w);
    if (t) return t;
  }
  const logs = await fetchLogs(ctx, w.fromBlock, w.toBlock);
  const times = await blockTimes(ctx.client, logs.map((l) => l.blockNumber));
  const built = buildChainWindows({
    cfg: ctx.cfg,
    from: w.fromBlock,
    to: w.toBlock,
    fromTime: w.fromTime,
    toTime: w.toTime,
    logs,
    blockTime: (n) => times.get(n)!,
  });
  const tree = w.kind === WINDOW_PAYOUT ? built.payout.tree : built.source?.tree ?? new SortedTree([]);
  if (tree.root !== w.root) {
    throw new Error(`rebuilt root mismatch for ${w.kind === WINDOW_PAYOUT ? "payout" : "source"} window on chain ${w.chainId} [${w.fromBlock}, ${w.toBlock}]`);
  }
  return tree;
}

async function rebuildNative(ctx: ChainCtx, w: AttestWindow): Promise<SortedTree | undefined> {
  const blk = await ctx.client.getBlock({ blockNumber: w.fromBlock, includeTransactions: true });
  const makers = new Set(ctx.cfg.makers.map((m) => m.toLowerCase()));
  for (const tx of blk.transactions) {
    if (typeof tx === "string" || !tx.to || !makers.has(tx.to.toLowerCase()) || tx.input !== "0x" || tx.value === 0n) continue;
    const built = nativeSourceWindow({
      chainId: Number(w.chainId),
      txHash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      blockNumber: w.fromBlock,
      timestamp: blk.timestamp,
    });
    if (built.tree.root === w.root) return built.tree;
  }
  return undefined;
}
