import { NextResponse } from "next/server";
import { keccak256, toHex } from "viem";
import { runtimeConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

/**
 * Stealth announcements from Envio HyperSync, so the Receive inbox doesn't page Monad's 100-block
 * eth_getLogs over the whole history (hundreds of thousands of blocks). Only Kakushi's own announcer
 * on a deployed chain is served (the token is not an open proxy). The browser reads the blocks
 * after `toBlock` over RPC.
 *   GET /api/announcements?chainId=10143&from=70440000 -> { logs: [...], toBlock }
 */
const HYPERSYNC: Record<number, string> = {
  10143: "https://10143.hypersync.xyz",
  11155111: "https://sepolia.hypersync.xyz",
};
const ANNOUNCEMENT = keccak256(toHex("Announcement(uint256,address,address,bytes,bytes)"));

interface HsLog { block_number: number; transaction_hash: string; log_index: number; data: string; topic0?: string; topic1?: string; topic2?: string; topic3?: string }

export async function GET(req: Request) {
  const token = process.env.ENVIO_API_TOKEN;
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId"));
  const from = Number(url.searchParams.get("from") ?? "0");
  const base = HYPERSYNC[chainId];
  if (!token || !base) return NextResponse.json({ error: "HyperSync is not configured for this chain" }, { status: 503 });
  if (!Number.isSafeInteger(from) || from < 0) return NextResponse.json({ error: "bad from" }, { status: 400 });
  const chain = (runtimeConfig().deployments as { chains?: Record<string, { privacy?: { stealthAnnouncer?: string } }> } | null)?.chains?.[String(chainId)];
  const announcer = chain?.privacy?.stealthAnnouncer;
  if (!announcer) return NextResponse.json({ error: "no announcer on this chain" }, { status: 404 });

  const logs: { blockNumber: string; transactionHash: string; logIndex: number; topics: string[]; data: string }[] = [];
  let next = from;
  let toBlock = from - 1;
  try {
    // HyperSync answers in pages up to its archive height; follow next_block until caught up
    for (let page = 0; page < 20; page++) {
      const r = await fetch(`${base}/query`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          from_block: next,
          logs: [{ address: [announcer], topics: [[ANNOUNCEMENT]] }],
          field_selection: { log: ["block_number", "transaction_hash", "log_index", "data", "topic0", "topic1", "topic2", "topic3"] },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`HyperSync ${r.status}`);
      const j = (await r.json()) as { data?: { logs?: HsLog[] }[]; next_block: number; archive_height: number };
      for (const d of j.data ?? []) {
        for (const l of d.logs ?? []) {
          logs.push({ blockNumber: String(l.block_number), transactionHash: l.transaction_hash, logIndex: l.log_index, topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter((t): t is string => Boolean(t)), data: l.data });
        }
      }
      toBlock = j.next_block - 1;
      if (j.next_block > j.archive_height || j.next_block <= next) break;
      next = j.next_block;
    }
  } catch (e) {
    return NextResponse.json({ error: `HyperSync unavailable: ${(e as Error).message}` }, { status: 502 });
  }
  return NextResponse.json({ logs, toBlock: String(toBlock), source: "envio-hypersync" });
}
