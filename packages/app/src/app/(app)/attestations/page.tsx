"use client";

import { useCallback } from "react";
import { DataTable, PanelCard } from "@kakushi/ui";
import { CHAIN_LIST } from "@kakushi/config";
import { readWindows, windowCount } from "@kakushi/sdk";
import { ChainName, Notice, PageHead, Pill, Stat, ago, readError , ArtBanner } from "@/components/kit";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";

export default function AttestationsPage() {
  const { k, cfg, error: runtimeError } = useRuntime();
  const load = useCallback(async () => {
    const n = await windowCount(k!.hub, k!.d.hub.attestationOracle);
    const ws = n === 0 ? [] : await readWindows(k!.hub, k!.d.hub.attestationOracle, Math.max(1, n - 59), n);
    const covered = await Promise.all(CHAIN_LIST.map(async (c) => ({ chainId: c.chainId, until: await k!.payoutCoveredUntil(c.chainId) })));
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
    return { n, ws: ws.reverse(), covered, indexedLag, lagError };
  }, [k, cfg]);
  const { data, error, loading } = usePoll(k ? load : null, 3000, [k, cfg]);
  const now = Math.floor(Date.now() / 1000);
  return (
    <div>
      <ArtBanner src="/art/attest-banner.webp" position="50% 55%" />
      <PageHead
        title="Attestations"
        sub="Chainlink CRE commits every Maker payout and source payment in each block window as a sorted Poseidon2 root on the Monad hub. Payout windows are block-contiguous, so a missing payout can be proven absent."
        right={cfg?.network === "local" ? <Pill tone="warn">Local CRE runner · same workflow, not a DON</Pill> : <Pill tone="indigo">Chainlink CRE</Pill>}
      />
      {!k && runtimeError && <Notice tone="warn" title="The hub is not reachable">{runtimeError}</Notice>}
      {data?.lagError && <Notice tone="warn">{data.lagError}</Notice>}
      {error && <Notice tone="warn" title="The oracle can't be read">{readError(error)}</Notice>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Windows on the hub" value={data ? data.n.toLocaleString() : "—"} sub={data ? "sorted Poseidon2 roots" : loading ? "reading the oracle…" : "unavailable"} className="bg-ui-surface-1" />
        {(data?.covered ?? CHAIN_LIST.map((c) => ({ chainId: c.chainId, until: 0n }))).map((c) => {
          const payout = data?.indexedLag?.find((x) => x.chainId === c.chainId && x.kind === 2);
          const source = data?.indexedLag?.find((x) => x.chainId === c.chainId && x.kind === 1);
          return (
            <Stat
              key={c.chainId}
              className="bg-ui-surface-1"
              label={<ChainName chainId={c.chainId} size={16} />}
              value={payout?.confirmedLagSeconds != null ? `${payout.confirmedLagSeconds} s lag` : c.until ? `${Math.max(0, now - Number(c.until))} s lag` : "—"}
              sub={source?.confirmedLagSeconds != null ? `source lag ${source.confirmedLagSeconds} s` : c.until ? `payouts attested to ${new Date(Number(c.until) * 1000).toLocaleTimeString()}` : "no window yet"}
            />
          );
        })}
      </div>
      <PanelCard title="Recent windows" subtitle="The latest 60 commitments, newest first">
        <DataTable
          caption="Attestation windows"
          loading={loading && !data}
          loadingRows={6}
          rows={data?.ws ?? []}
          rowKey={(w) => String(w.id)}
          empty={<p className="py-12 text-center text-[15px] text-ui-muted">{error ? "Windows appear here once the oracle can be read." : k ? "No windows yet. Start the attester (pnpm --filter @kakushi/cre local, or cre workflow simulate)." : "Windows appear once the hub is deployed and reachable."}</p>}
          columns={[
            { key: "id", header: "#", render: (w) => <span className="ui-figure text-ui-muted">{w.id}</span> },
            { key: "chain", header: "Chain", render: (w) => <ChainName chainId={Number(w.chainId)} size={24} /> },
            { key: "kind", header: "Kind", render: (w) => (w.kind === 2 ? <Pill tone="indigo">Payouts</Pill> : <Pill>Source</Pill>) },
            { key: "blocks", header: "Blocks", hideBelow: "md", render: (w) => <span className="ui-figure font-mono text-[13px]">{w.fromBlock.toString()}–{w.toBlock.toString()}</span> },
            { key: "leaves", header: "Leaves", align: "right", render: (w) => <span className="ui-figure">{w.leafCount}</span> },
            { key: "root", header: "Root", hideBelow: "lg", render: (w) => <span className="font-mono text-[13px] text-ui-muted">0x{w.root.toString(16).slice(0, 10)}…</span> },
            { key: "ends", header: "Ends", align: "right", render: (w) => <span className="text-ui-muted">{ago(w.toTime)}</span> },
          ]}
        />
      </PanelCard>
    </div>
  );
}
