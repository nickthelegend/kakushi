"use client";

import { useCallback } from "react";
import Link from "next/link";
import { zeroAddress, type Hex } from "viem";
import { CHAINS } from "@kakushi/config";
import type { PairInfo } from "@kakushi/sdk";
import { PanelCard, PrimaryButton, cn } from "@kakushi/ui";
import { Store } from "lucide-react";
import { Amount, Empty, Loading, Notice, PageHead, Pill, Route, Stat, readError, short } from "@/components/kit";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";

interface RouteStats { pairId: string; observedSources: number; fills: number; refunds: number; p50LatencyMs: number | null }

interface MakerView {
  address: Hex;
  name: string;
  online: boolean | null;
  paused: boolean;
  pairs: PairInfo[];
  margin: bigint;
  required: bigint | null;
  openDisputes: bigint;
  fills: number | null;
  refunds: number | null;
  missed: number | null;
  p50: number | null;
  slashed: number | null;
  indexed: boolean;
  routeStats: RouteStats[] | null;
  statsError: string | null;
  statsLimited: boolean;
}

export default function MakersPage() {
  const { k, cfg, error: runtimeError } = useRuntime();
  const load = useCallback(async (): Promise<MakerView[]> => {
    const onchain = await k!.makers();
    let indexed: { maker: string; fills: number; refunds: number; disputesLost: number; p50LatencyMs: number | null }[] | null = null;
    let routeStats: RouteStats[] | null = null;
    let statsError: string | null = null;
    let statsLimited = false;
    if (cfg?.envioStatsEnabled) {
      try {
        const response = await fetch("/api/stats", { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Envio statistics unavailable");
        const stats = await response.json();
        indexed = stats.makers;
        routeStats = stats.routes;
        statsLimited = stats.possiblyTruncated;
      } catch {
        statsError = "Envio statistics unavailable. Counts remain unknown until a successful read.";
      }
    } else if (cfg?.services.indexer) {
      try {
        const h = await fetch("/api/svc/indexer/health");
        if (!h.ok) throw new Error("History unavailable");
        const health = await h.json();
        if (health.network !== cfg.network || !health.lastSuccessfulScan || health.lastError) throw new Error("History catching up");
        const r = await fetch("/api/svc/indexer/makers");
        if (r.ok) indexed = (await r.json()).items;
        const routes = await fetch("/api/svc/indexer/routes");
        if (routes.ok) routeStats = (await routes.json()).items;
      } catch {}
    }
    let watched: { maker: string; status: string }[] | null = null;
    try {
      const r = await fetch("/api/svc/watchtower/watched");
      if (r.ok) watched = await r.json();
    } catch {}
    return Promise.all(
      onchain.map(async (address) => {
        const idx = cfg!.makers.findIndex((m) => m.address.toLowerCase() === address.toLowerCase());
        const name = idx >= 0 ? cfg!.makers[idx]!.name : short(address);
        let online: boolean | null = null;
        let paused = false;
        let fills: number | null = null, refunds: number | null = null, missed: number | null = null;
        let p50: number | null = null;
        if (idx >= 0) {
          try {
            const h = await fetch(`/api/svc/maker-${idx}/health`, { signal: AbortSignal.timeout(3000) });
            online = h.ok;
            if (h.ok) paused = (await h.json()).paused;
            const pr = await fetch(`/api/svc/maker-${idx}/payments?limit=200`);
            if (pr.ok) {
              const rows = (await pr.json()) as { status: string; executedMs: number | null }[];
              fills = rows.filter((r) => r.status === "filled").length;
              refunds = rows.filter((r) => r.status === "refunded").length;
              missed = rows.filter((r) => r.status === "missed").length;
              const ms = rows.map((r) => r.executedMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
              p50 = ms.length ? ms[Math.floor(ms.length / 2)]! : null;
            }
          } catch {
            online = false;
          }
        }
        const pairs = await k!.pairs(address);
        const m = await k!.margin(address, CHAINS.monadTestnet.usdc.address);
        let slashed = watched?.filter((w) => w.maker === address.toLowerCase() && w.status === "slashed").length ?? null;
        if (cfg?.services.indexer || cfg?.envioStatsEnabled) {
          const stats = indexed?.find((x) => x.maker.toLowerCase() === address.toLowerCase());
          fills = stats?.fills ?? null;
          refunds = stats?.refunds ?? null;
          slashed = stats?.disputesLost ?? null;
          p50 = stats?.p50LatencyMs ?? null;
        }
        return { address, name, online, paused, pairs, margin: m.margin, required: m.required, openDisputes: m.openDisputes, fills, refunds, missed, p50, slashed, indexed: Boolean(cfg?.services.indexer || cfg?.envioStatsEnabled), routeStats, statsError, statsLimited };
      }),
    );
  }, [k, cfg]);
  const { data, error, loading } = usePoll(k && cfg ? load : null, 5000, [k, cfg]);
  return (
    <div>
      <PageHead
        title="Makers"
        sub="An open market. Each Maker posts margin on Monad, registers routes and fees in the EBC, and fills from its own inventory."
        right={<PrimaryButton asChild icon={<Store />}><Link href="/maker">Become a Maker</Link></PrimaryButton>}
      />
      {runtimeError && <Notice tone="warn" title="The Maker registry is unavailable">{runtimeError}</Notice>}
      {!cfg && !runtimeError && <Loading>Loading the Maker registry…</Loading>}
      {error && <Notice tone="warn" title="Makers can't be read">{readError(error)}</Notice>}
      {cfg?.envioStatsEnabled && <Notice>Maker and route statistics come from Envio observations. A successful query does not establish that indexing has caught up.</Notice>}
      {data?.[0]?.statsError && <Notice tone="warn">{data[0].statsError}</Notice>}
      {data?.[0]?.statsLimited && <Notice tone="warn">This view is limited to 200 Maker and route observations.</Notice>}
      {loading && !data && <Loading>Reading the hub…</Loading>}
      {data && data.length === 0 && <Empty title="No Makers registered yet" action={<PrimaryButton asChild size="sm"><Link href="/maker">Register the first one</Link></PrimaryButton>}>Post margin and register a route from the Maker console.</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.map((m) => {
          const covered = m.required !== null && m.required > 0n ? Math.min(100, Number((m.margin * 100n) / m.required)) : null;
          return (
            <PanelCard
              key={m.address}
              title={m.name}
              subtitle={<span className="font-mono text-[12px] break-all">{m.address}</span>}
              badge={m.online === null ? <Pill>No endpoint</Pill> : m.online ? (m.paused ? <Pill tone="warn">Paused</Pill> : <Pill tone="ok">Online</Pill>) : <Pill tone="bad">Offline</Pill>}
            >
              <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Margin" value={<Amount value={m.margin} decimals={6} max={0} />} sub={m.required === null ? "price stale" : <>needs <Amount value={m.required} decimals={6} max={0} /></>} />
                <Stat label="Fills" value={m.fills ?? "—"} sub={m.refunds === null ? "history unavailable" : `${m.refunds} refunds`} />
                <Stat label="p50 payout" value={m.p50 === null ? "—" : `${m.p50} ms`} sub={m.indexed ? "source → payout" : "submit → receipt"} />
                <Stat label="Slashed" value={m.slashed ?? "—"} sub={`${m.openDisputes} open disputes`} />
              </div>
              {covered !== null && (
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-[13px] text-ui-muted"><span>Margin against requirement</span><span className="ui-figure">{covered}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ui-canvas"><div className={cn("h-full rounded-full", covered >= 100 ? "bg-ui-lime-button" : "bg-ui-warn")} style={{ width: `${covered}%` }} /></div>
                </div>
              )}
              <div className="mt-4 grid gap-1.5">
                {m.pairs.map((p) => {
                  const native = p.srcToken === zeroAddress;
                  const stats = m.routeStats?.find((s) => s.pairId.toLowerCase() === p.pairId.toLowerCase());
                  return (
                    <div key={p.pairId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[18px] bg-ui-canvas px-4 py-3 text-[14px]">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Route src={p.srcChainId} dst={p.dstChainId} size={18} />
                        <span className="text-ui-muted">{native ? "ETH" : "USDC"}</span>
                        <span className="ui-figure code-digits text-[13px]">{p.identCode}</span>
                        {!p.active && <Pill tone="warn">Inactive</Pill>}
                      </span>
                      <span className="ui-figure text-ui-muted">
                        {Number(p.tradingFeeBps) / 100}% + <Amount value={p.withholdingFee} decimals={native ? 18 : 6} /> · max <Amount value={p.maxAmount} decimals={native ? 18 : 6} />
                      </span>
                      {stats && <span className="w-full text-[12px] text-ui-muted">{stats.fills} fills · {stats.refunds} refunds · {stats.observedSources} source payments{stats.p50LatencyMs === null ? "" : ` · p50 ${stats.p50LatencyMs} ms`}</span>}
                    </div>
                  );
                })}
              </div>
            </PanelCard>
          );
        })}
      </div>
    </div>
  );
}
