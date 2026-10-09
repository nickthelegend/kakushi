"use client";

import { useCallback } from "react";
import { CHAIN_LIST } from "@kakushi/config";
import { readWindows, windowCount } from "@kakushi/sdk";
import { Card, ChainName, Empty, Notice, Pill, Spinner, Stat, ago, PageHeader } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { Art } from "@/components/Art";
import { usePoll } from "@/lib/usePoll";

export default function AttestationsPage() {
  const { k, cfg } = useRuntime();
  const load = useCallback(async () => {
    const n = await windowCount(k!.hub, k!.d.hub.attestationOracle);
    const ws = n === 0 ? [] : await readWindows(k!.hub, k!.d.hub.attestationOracle, Math.max(1, n - 59), n);
    const covered = await Promise.all(CHAIN_LIST.map(async (c) => ({ chainId: c.chainId, until: await k!.payoutCoveredUntil(c.chainId) })));
    let status: any = null;
    try {
      const r = await fetch("/api/svc/attester/status");
      if (r.ok) status = await r.json();
    } catch {}
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
      } catch { lagError = "Indexed lag unavailable; onchain windows are shown below."; }
    }
    return { n, ws: ws.reverse(), covered, status, indexedLag, lagError };
  }, [k, cfg]);
  const { data, error, loading } = usePoll(k ? load : null, 3000, [k, cfg]);
  const now = Math.floor(Date.now() / 1000);
  return (
    <div>
      <Art src="/art/attest-banner.webp" alt="" className="mb-8 aspect-[21/7] w-full rounded-[16px] object-cover opacity-90" />
      <PageHeader
        title="Attestations"
        subtitle="Chainlink CRE commits every Maker payout and source payment of each block window as a sorted Poseidon2 root on the Monad hub. Payout windows must be block-contiguous, so a missing payout can be proven absent."
        right={cfg?.network === "local" ? <Pill tone="warn">local CRE runner · same workflow logic · not a DON</Pill> : <Pill tone="indigo">Chainlink CRE</Pill>}
      />
      {data?.lagError && <Notice tone="warn">{data.lagError}</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}
      {loading && !data && <Card className="flex items-center gap-3"><Spinner /> Reading the oracle…</Card>}
      {data && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <Stat label="Windows on the hub" value={data.n.toLocaleString()} />
            {data.covered.map((c) => {
              const payout = data.indexedLag?.find((x) => x.chainId === c.chainId && x.kind === 2);
              const source = data.indexedLag?.find((x) => x.chainId === c.chainId && x.kind === 1);
              return <Stat key={c.chainId} label={<ChainName chainId={c.chainId} />} value={payout?.confirmedLagSeconds != null ? `${payout.confirmedLagSeconds} s payout lag` : c.until ? `${Math.max(0, now - Number(c.until))} s clock lag` : "—"} sub={source?.confirmedLagSeconds != null ? `source lag ${source.confirmedLagSeconds} s · confirmed chain head` : c.until ? `payouts attested to ${new Date(Number(c.until) * 1000).toLocaleTimeString()}` : "no window yet"} />;
            })}
          </div>
          {data.ws.length === 0 ? (
            <Empty title="No windows yet">Start the attester (pnpm --filter @kakushi/cre local, or cre workflow simulate).</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-3 font-normal">#</th>
                    <th className="px-3 py-3 font-normal">Chain</th>
                    <th className="px-3 py-3 font-normal">Kind</th>
                    <th className="px-3 py-3 font-normal">Blocks</th>
                    <th className="px-3 py-3 font-normal">Leaves</th>
                    <th className="px-3 py-3 font-normal">Root</th>
                    <th className="px-5 py-3 font-normal">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ws.map((w) => (
                    <tr key={w.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 text-muted tabular">{w.id}</td>
                      <td className="px-3 py-2.5"><ChainName chainId={Number(w.chainId)} /></td>
                      <td className="px-3 py-2.5">{w.kind === 2 ? <Pill tone="indigo">payouts</Pill> : <Pill>source</Pill>}</td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular">{w.fromBlock.toString()}–{w.toBlock.toString()}</td>
                      <td className="px-3 py-2.5 tabular">{w.leafCount}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted">0x{w.root.toString(16).slice(0, 10)}…</td>
                      <td className="px-5 py-2.5 text-muted">{ago(w.toTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
