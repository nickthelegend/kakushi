"use client";

import { useCallback, useMemo, useState } from "react";
import { DataTable, PanelCard } from "@kakushi/ui";
import { CHAIN_LIST, deployedChains } from "@kakushi/config";
import { readWindows, windowCount } from "@kakushi/sdk";
import { ChainName, Notice, PageHead, Pill, Stat, ago, readError } from "@/components/kit";

/** Seconds as "42 s", "12 min" or "1 h 34 min". */
function behind(secs: number): string {
  const s = Math.round(secs);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const m = Math.floor((s % 3600) / 60);
  return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ""}`;
}
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";

export default function AttestationsPage() {
  const { k, cfg, error: runtimeError } = useRuntime();
  const chains = useMemo(() => (cfg?.deployments ? deployedChains(cfg.deployments) : CHAIN_LIST), [cfg]);
  const load = useCallback(async () => {
    const n = await windowCount(k!.hub, k!.d.hub.attestationOracle);
    const ws = n === 0 ? [] : await readWindows(k!.hub, k!.d.hub.attestationOracle, Math.max(1, n - 59), n);
    const covered = await Promise.all(chains.map(async (c) => ({ chainId: c.chainId, until: await k!.payoutCoveredUntil(c.chainId) })));
    let indexedLag: { chainId: number; kind: number; confirmedLagSeconds: number | null }[] | null = null;
    let lagError: string | null = null;
    if (cfg?.services.indexer) {
      try {
        const h = await fetch("/api/svc/indexer/health");
        if (!h.ok) throw new Error("Indexed lag unavailable");
        const health = await h.json();
        if (health.network !== cfg.network || !health.lastSuccessfulScan || health.lastError) throw new Error("Indexed lag unavailable");
        const r = await fetch("/api/svc/indexer/attestations");
        if (!r.ok) throw new Error("Indexed lag unavailable");
        indexedLag = (await r.json()).items;
      } catch {
        lagError = "Indexed lag unavailable; onchain windows are shown below.";
      }
    }
    // newest first by when the window ends (ids are per-submission, so they interleave chains)
    const sorted = [...ws].sort((a, b) => (Number(b.toTime) - Number(a.toTime)) || (b.id > a.id ? 1 : -1));
    return { n, ws: sorted, covered, indexedLag, lagError };
  }, [k, cfg, chains]);
  const { data, error, loading } = usePoll(k ? load : null, 3000, [k, cfg]);
  const now = Math.floor(Date.now() / 1000);
  const [showEmpty, setShowEmpty] = useState(false);
  const empty = data?.ws.filter((w) => w.leafCount === 0).length ?? 0;
  const rows = (data?.ws ?? []).filter((w) => showEmpty || w.leafCount > 0);
  return (
    <div>
      <PageHead
        title="Attestations"
        sub="Kakushi's attester runs the Chainlink CRE workflow logic and commits each block window of Maker payouts and source payments as one root on the Monad hub. Windows leave no gaps, so a missing payout can be proven."
        right={cfg?.network === "local" ? <Pill tone="warn">Local CRE runner · same workflow, not a DON</Pill> : <Pill tone="indigo">CRE workflow · Kakushi runner, not a DON</Pill>}
      />
      {!k && runtimeError && <Notice tone="warn" title="The hub is not reachable">{runtimeError}</Notice>}
      {data?.lagError && <Notice tone="warn">{data.lagError}</Notice>}
      {error && <Notice tone="warn" title="The oracle can't be read">{readError(error)}</Notice>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Windows on the hub" value={data ? data.n.toLocaleString() : "—"} sub={data ? "sorted Poseidon2 roots" : loading ? "reading the oracle…" : "unavailable"} className="bg-ui-surface-1" />
        {(data?.covered ?? chains.map((c) => ({ chainId: c.chainId, until: 0n }))).map((c) => {
          const payout = data?.indexedLag?.find((x) => x.chainId === c.chainId && x.kind === 2);
          return (
            <Stat
              key={c.chainId}
              className="bg-ui-surface-1"
              label={<ChainName chainId={c.chainId} size={16} />}
              value={payout?.confirmedLagSeconds != null ? `${behind(payout.confirmedLagSeconds)} behind` : c.until ? `${behind(Math.max(0, now - Number(c.until)))} behind` : "—"}
              sub={c.until ? `payouts attested to ${new Date(Number(c.until) * 1000).toLocaleTimeString()}` : "no window yet"}
            />
          );
        })}
      </div>
      <p className="mb-6 px-1 text-[13px] text-ui-muted">Busy ranges are attested within a minute; quiet ranges are batched every 2 h.</p>
      <PanelCard
        title="Recent windows"
        subtitle={empty ? (
          <span>
            Newest first. {empty} empty {empty === 1 ? "window" : "windows"} (no payments) {showEmpty ? "shown" : "hidden"}.{" "}
            <button type="button" onClick={() => setShowEmpty((v) => !v)} className="text-ui-lime-text hover:underline">{showEmpty ? "Hide" : "Show"}</button>
          </span>
        ) : "Newest first"}
      >
        <DataTable
          caption="Attestation windows"
          loading={loading && !data}
          loadingRows={6}
          rows={rows}
          rowKey={(w) => String(w.id)}
          empty={<p className="py-12 text-center text-[15px] text-ui-muted">{error ? "Windows appear here once the oracle can be read." : data?.ws.length ? "No payments in the latest windows." : k ? "No windows yet. Start the attester (pnpm --filter @kakushi/cre local, or cre workflow simulate)." : "Windows appear once the hub is deployed and reachable."}</p>}
          columns={[
            { key: "id", header: "#", hideBelow: "sm", render: (w) => <span className="ui-figure text-ui-muted">{w.id}</span> },
            {
              key: "chain",
              header: "Chain",
              render: (w) => (
                <span className="flex flex-col items-start gap-1 sm:flex-row sm:items-center">
                  <ChainName chainId={Number(w.chainId)} size={20} />
                  <span className="sm:hidden">{w.kind === 2 ? <Pill tone="indigo">Payouts</Pill> : <Pill>Source</Pill>}</span>
                </span>
              ),
            },
            { key: "kind", header: "Kind", hideBelow: "sm", render: (w) => (w.kind === 2 ? <Pill tone="indigo">Payouts</Pill> : <Pill>Source</Pill>) },
            { key: "blocks", header: "Blocks", hideBelow: "md", render: (w) => <span className="ui-figure font-mono text-[13px]">{w.fromBlock.toString()}–{w.toBlock.toString()}</span> },
            { key: "leaves", header: "Payments", align: "right", render: (w) => <span className="ui-figure">{w.leafCount}</span> },
            { key: "root", header: "Root", hideBelow: "lg", render: (w) => <span className="font-mono text-[13px] text-ui-muted">0x{w.root.toString(16).slice(0, 10)}…</span> },
            { key: "ends", header: "Ends", align: "right", render: (w) => <span className="whitespace-nowrap text-ui-muted">{ago(w.toTime)}</span> },
          ]}
        />
      </PanelCard>
    </div>
  );
}
