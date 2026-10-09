"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { CHAINS, chainById } from "@kakushi/config";
import { Amount, Card, ChainDot, Empty, Notice, Pill, Spinner, ago, short, PageHeader } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { usePoll } from "@/lib/usePoll";

interface Row {
  srcRef: string;
  logIndex?: number;
  maker: string;
  srcChainId: number;
  txHash: string;
  sender: string;
  token: string;
  gross: string;
  timestamp: number;
  status: string;
  note: string | null;
}

const STATUS: Record<string, { tone: "ok" | "bad" | "warn" | "accent" | "indigo" | "neutral"; label: string }> = {
  pending: { tone: "accent", label: "pending payout" },
  filled: { tone: "ok", label: "payout observed" },
  refunded: { tone: "ok", label: "refund observed" },
  expired: { tone: "warn", label: "dispute expired" },
  watching: { tone: "accent", label: "in flight" },
  paid: { tone: "ok", label: "settled" },
  overdue: { tone: "bad", label: "overdue" },
  proving: { tone: "warn", label: "proving" },
  disputed: { tone: "warn", label: "disputed" },
  slashed: { tone: "indigo", label: "compensated" },
  "maker-proven": { tone: "ok", label: "maker proved payout" },
  "no-obligation": { tone: "neutral", label: "no obligation" },
  unprovable: { tone: "warn", label: "proof unavailable" },
};

export default function ActivityPage() {
  const { cfg } = useRuntime();
  const w = useWallet();
  const historySource = cfg?.services.indexer ? "indexer" : cfg?.services.watchtower ? "watchtower" : null;
  const load = useCallback(async () => {
    if (cfg?.services.indexer) {
      const health = await fetch("/api/svc/indexer/health");
      if (!health.ok) throw new Error("History indexer is unavailable");
      const state = await health.json() as { network: string; lastSuccessfulScan: number | null; lastError: string | null };
      if (state.network !== cfg.network || !state.lastSuccessfulScan || state.lastError) throw new Error(state.lastError ?? "History indexer is catching up");
      const r = await fetch(`/api/svc/indexer/transfers?limit=200${w.address ? `&sender=${w.address}` : ""}`);
      if (!r.ok) throw new Error("History indexer is unavailable");
      const payload = await r.json() as { items: { srcRef: string; status: string; source: { logIndex: number; chainId: number; txHash: string; timestamp: number; args: Record<string, string> } | null }[] };
      return payload.items.filter((t) => t.source).map((t): Row => ({ srcRef: t.srcRef, logIndex: t.source!.logIndex, maker: t.source!.args.maker!, srcChainId: t.source!.chainId, txHash: t.source!.txHash, sender: t.source!.args.sender!, token: t.source!.args.token!, gross: t.source!.args.gross!, timestamp: t.source!.timestamp, status: t.status, note: null }));
    }
    const r = await fetch("/api/svc/watchtower/watched");
    if (!r.ok) throw new Error((await r.json()).error ?? "watchtower unavailable");
    return (await r.json()) as Row[];
  }, [cfg, w.address]);
  const { data, error, loading } = usePoll(historySource ? load : null, 4000, [cfg, w.address]);
  const mine = (data ?? []).filter((r) => !w.address || r.sender.toLowerCase() === w.address.toLowerCase());
  return (
    <div>
      <PageHeader title="Activity" subtitle={w.address ? `Transfers sent by ${short(w.address)}, from indexed chain events.` : "Every transfer to a Kakushi Maker, from indexed chain events. Connect a wallet to see only yours."} />
      {cfg && !historySource && <Notice tone="warn">History is unavailable: neither the indexer nor Watchtower is configured.</Notice>}
      {error && <Notice tone="warn">History: {error}</Notice>}
      {loading && !data && <Card className="flex items-center gap-3"><Spinner /> Loading…</Card>}
      {data && mine.length === 0 && <Empty title="No transfers yet">Send one from the <Link href="/bridge" className="text-accent">Bridge</Link>.</Empty>}
      {mine.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-normal">When</th>
                <th className="px-3 py-3 font-normal">From</th>
                <th className="px-3 py-3 font-normal">Amount</th>
                <th className="px-3 py-3 font-normal">Maker</th>
                <th className="px-3 py-3 font-normal">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => {
                const native = r.token === "0x0000000000000000000000000000000000000000";
                const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
                const maker = cfg?.makers.find((m) => m.address.toLowerCase() === r.maker)?.name ?? short(r.maker);
                return (
                  <tr key={`${r.srcRef}${r.maker}`} className="border-b border-line last:border-0 hover:bg-s2/50">
                    <td className="px-5 py-3 text-muted">{ago(r.timestamp)}</td>
                    <td className="px-3 py-3"><span className="inline-flex items-center gap-2"><ChainDot chainId={r.srcChainId} />{chainById(r.srcChainId).shortName}</span></td>
                    <td className="px-3 py-3"><Amount value={BigInt(r.gross)} decimals={native ? 18 : 6} symbol={native ? "ETH" : "USDC"} max={4} /></td>
                    <td className="px-3 py-3">{maker}</td>
                    <td className="px-3 py-3"><Pill tone={st.tone}>{st.label}</Pill></td>
                    <td className="px-5 py-3 text-right"><Link className="inline-flex items-center gap-1 text-accent" href={`/tx/${r.srcChainId}/${r.txHash}${r.logIndex === undefined ? "" : `?log=${r.logIndex}`}`}>Open <ArrowRight className="size-3.5" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {historySource && <p className="mt-4 text-xs text-dim">Source: {historySource === "indexer" ? "persistent RPC event indexer" : "Watchtower observed transfers"} across {Object.values(CHAINS).length} chains. Latest 200 transfers.</p>}
    </div>
  );
}
