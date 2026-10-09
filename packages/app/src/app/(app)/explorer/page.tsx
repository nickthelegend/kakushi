"use client";

import { DataTable, TableName, cn } from "@kakushi/ui";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CHAIN_LIST, chainById, chainByIdentCode } from "@kakushi/config";
import { ChainCoin } from "@/components/coins";
import { Amount, Notice, Pill, ago, readError, short, type Tone } from "@/components/kit";
import { useIndexer, type Overview } from "@/lib/engage";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";

interface Ev { chainId: number; txHash: string; logIndex: number; timestamp: number; args: Record<string, string> }
interface Row { srcRef: string; source: Ev | null; payout: Ev | null; dispute: Ev | null; status: string; latencyMs: number | null }

const STATUS: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "accent", label: "In flight" },
  filled: { tone: "ok", label: "Completed" },
  refunded: { tone: "ok", label: "Refunded" },
  disputed: { tone: "warn", label: "Disputed" },
  slashed: { tone: "indigo", label: "Paid from margin" },
  "maker-proven": { tone: "ok", label: "Maker proved payout" },
  expired: { tone: "warn", label: "Dispute expired" },
};
const ZERO = "0x0000000000000000000000000000000000000000";
const isHash = (q: string) => /^0x[0-9a-fA-F]{64}$/.test(q);
const isAddr = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-ui-surface-1/80 px-5 py-4 ring-1 ring-ui-hairline-strong backdrop-blur">
      <div className="text-[13px] text-ui-muted">{label}</div>
      <div className="serif mt-1 text-[30px] leading-none">{value}</div>
    </div>
  );
}

function ExplorerView() {
  const { cfg } = useRuntime();
  const w = useWallet();
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [tab, setTab] = useState<"all" | "mine">("all");
  const query = q.trim();
  const sender = tab === "mine" && w.address ? w.address.toLowerCase() : isAddr(query) ? query.toLowerCase() : null;
  const transfers = useIndexer<{ total: number; items: Row[] }>(`transfers?limit=100${sender ? `&sender=${sender}` : ""}`, 5000);
  const overview = useIndexer<Overview>("stats/overview", 15000);
  const makerName = (a: string) => cfg?.makers.find((m) => m.address.toLowerCase() === a.toLowerCase())?.name ?? short(a);
  const rows = useMemo(() => {
    const items = (transfers.data?.items ?? []).filter((r) => r.source);
    return isHash(query) ? items.filter((r) => r.source!.txHash.toLowerCase() === query.toLowerCase() || r.payout?.txHash.toLowerCase() === query.toLowerCase()) : items;
  }, [transfers.data, query]);
  const ov = overview.data;

  return (
    <div className="mx-auto max-w-[1180px]">
      <header className="pt-6 text-center sm:pt-10">
        <h1 className="text-[clamp(40px,5.5vw,72px)] leading-[1.02]">Explorer</h1>
        <p className="mx-auto mt-3 max-w-[56ch] text-[16px] text-ui-muted">Every Kakushi transfer across Monad and its spokes, read live from chain events.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.replace(query ? `/explorer?q=${encodeURIComponent(query)}` : "/explorer");
          }}
          className="mx-auto mt-7 flex h-14 max-w-[680px] items-center gap-3 rounded-full bg-ui-surface-1/90 pr-2 pl-5 ring-1 ring-ui-hairline-strong backdrop-blur focus-within:ring-[#3b55ff]/60"
        >
          <Search aria-hidden size={18} className="shrink-0 text-ui-muted" />
          <input aria-label="Search by transaction hash or address" value={q} onChange={(e) => setQ(e.target.value.trim())} placeholder="Search by transaction hash or wallet address" className="min-w-0 flex-1 bg-transparent font-mono text-[14px] outline-none placeholder:font-sans placeholder:text-ui-muted" />
          <button type="submit" className="h-10 rounded-full bg-ui-lime-button px-5 text-[14px] font-semibold text-white">Search</button>
        </form>
        {isHash(query) && transfers.data && rows.length === 0 ? (
          <div className="mx-auto mt-4 flex max-w-[680px] flex-wrap items-center justify-center gap-2 text-[13px] text-ui-muted">
            Not in the latest transfers. Open it on:
            {CHAIN_LIST.map((c) => (
              <Link key={c.chainId} href={`/tx/${c.chainId}/${query}`} className="inline-flex items-center gap-1.5 rounded-full bg-ui-surface-2 px-2.5 py-1 hover:bg-ui-surface-3">
                <ChainCoin chainId={c.chainId} size={14} /> {c.shortName}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Transfers, 24 h" value={ov ? ov.transfers24h.toLocaleString("en-US") : "—"} />
        <Stat label="All transfers" value={ov ? ov.transfersAll.toLocaleString("en-US") : "—"} />
        <Stat label="Wallets" value={ov ? ov.users.toLocaleString("en-US") : "—"} />
        <Stat label="Median time to fill" value={ov?.medianLatencyMs != null ? `${(ov.medianLatencyMs / 1000).toFixed(1)} s` : "—"} />
      </div>

      <section className="mt-6 rounded-[28px] bg-ui-surface-1/80 p-4 ring-1 ring-ui-hairline-strong backdrop-blur sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-full bg-ui-canvas p-1">
            {(["all", "mine"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} disabled={t === "mine" && !w.address} className={cn("rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors disabled:opacity-40", tab === t ? "bg-ui-surface-2 text-ui-text" : "text-ui-muted hover:text-ui-text")}>
                {t === "all" ? "All transfers" : "My transfers"}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-ui-muted">{transfers.data ? `${transfers.data.total.toLocaleString("en-US")} indexed` : ""}</span>
        </div>
        {!transfers.configured && transfers.ready ? <Notice tone="warn" title="The explorer needs the indexer">This deployment has no indexer configured, so there is no transfer history to show yet.</Notice> : null}
        {transfers.error ? <Notice tone="warn" title="The indexer isn't reachable">{readError(transfers.error)}</Notice> : null}
        {transfers.configured && !transfers.error ? (
          <DataTable
            caption="Kakushi transfers"
            loading={transfers.loading && !transfers.data}
            loadingRows={8}
            rows={rows}
            rowKey={(r) => r.srcRef}
            onRowClick={(r) => router.push(`/tx/${r.source!.chainId}/${r.source!.txHash}?log=${r.source!.logIndex}`)}
            empty={<p className="py-14 text-center text-[15px] text-ui-muted">{tab === "mine" ? <>You haven&rsquo;t bridged yet. <Link href="/bridge" className="text-ui-lime-text hover:underline">Make your first transfer</Link></> : "No transfers yet."}</p>}
            columns={[
              {
                key: "route",
                header: "Route",
                render: (r) => {
                  const dst = chainByIdentCode(Number(r.source!.args.gross!.slice(-4)));
                  return (
                    <span className="flex items-center gap-2.5">
                      <span className="flex -space-x-1.5">
                        <ChainCoin chainId={r.source!.chainId} size={26} />
                        <ChainCoin chainId={dst?.chainId ?? r.source!.chainId} size={26} />
                      </span>
                      <span className="hidden text-[13px] text-ui-muted sm:inline">{chainById(r.source!.chainId).shortName} → {dst?.shortName ?? "refund"}</span>
                    </span>
                  );
                },
              },
              { key: "amount", header: "Amount", align: "right", render: (r) => { const native = r.source!.args.token === ZERO; return <Amount value={BigInt(r.source!.args.gross!)} decimals={native ? 18 : 6} symbol={native ? "ETH" : "USDC"} max={4} />; } },
              { key: "from", header: "From", hideBelow: "md", render: (r) => <TableName title={<span className="font-mono text-[13px]">{short(r.source!.args.sender!)}</span>} /> },
              { key: "maker", header: "Maker", hideBelow: "lg", render: (r) => makerName(r.source!.args.maker!) },
              { key: "time", header: "Filled in", align: "right", hideBelow: "md", render: (r) => <span className="ui-figure text-ui-muted">{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)} s` : "—"}</span> },
              { key: "status", header: "Status", render: (r) => { const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status }; return <Pill tone={st.tone}>{st.label}</Pill>; } },
              { key: "when", header: "", align: "right", hideBelow: "sm", render: (r) => <span className="inline-flex items-center gap-1 text-ui-muted">{ago(r.source!.timestamp)} <ArrowRight aria-hidden size={13} /></span> },
            ]}
          />
        ) : null}
      </section>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense>
      <ExplorerView />
    </Suspense>
  );
}
