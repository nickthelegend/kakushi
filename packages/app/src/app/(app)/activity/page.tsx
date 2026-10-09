"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, PanelCard, PrimaryButton, TableName } from "@kakushi/ui";
import { useCallback } from "react";
import { Send } from "lucide-react";
import { CHAINS, chainById } from "@kakushi/config";
import { Amount, Notice, PageHead, Pill, ago, readError, short } from "@/components/kit";
import { ChainCoin } from "@/components/coins";
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
  pending: { tone: "accent", label: "Awaiting payout" },
  filled: { tone: "ok", label: "Paid out" },
  refunded: { tone: "ok", label: "Refunded" },
  expired: { tone: "warn", label: "Dispute expired" },
  watching: { tone: "accent", label: "In flight" },
  paid: { tone: "ok", label: "Settled" },
  overdue: { tone: "bad", label: "Overdue" },
  proving: { tone: "warn", label: "Proving" },
  disputed: { tone: "warn", label: "Disputed" },
  slashed: { tone: "indigo", label: "Paid from margin" },
  "maker-proven": { tone: "ok", label: "Maker proved payout" },
  "no-obligation": { tone: "neutral", label: "No obligation" },
  unprovable: { tone: "warn", label: "Proof unavailable" },
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
  const router = useRouter();
  const makerName = (a: string) => cfg?.makers.find((m) => m.address.toLowerCase() === a.toLowerCase())?.name ?? short(a);
  return (
    <div>
      <PageHead
        title="Activity"
        sub={w.address ? `Transfers sent by ${short(w.address)}, read from chain events.` : "Every transfer to a Kakushi Maker, read from chain events. Connect a wallet to see only yours."}
        right={<PrimaryButton asChild icon={<Send />}><Link href="/bridge">New transfer</Link></PrimaryButton>}
      />
      {cfg && !historySource && <Notice tone="warn" title="History is unavailable">Neither the indexer nor the Watchtower is configured for this deployment.</Notice>}
      {error && <Notice tone="warn" title="History is unavailable">{readError(error)}</Notice>}
      <PanelCard title="Transfers" subtitle={historySource ? `${historySource === "indexer" ? "Persistent RPC event indexer" : "Watchtower observations"} across ${Object.values(CHAINS).length} chains · latest 200` : undefined}>
        <DataTable
          caption="Transfers"
          loading={loading && !data}
          loadingRows={5}
          rows={mine}
          rowKey={(r) => `${r.srcRef}${r.maker}`}
          onRowClick={(r) => router.push(`/tx/${r.srcChainId}/${r.txHash}${r.logIndex === undefined ? "" : `?log=${r.logIndex}`}`)}
          empty={<p className="py-12 text-center text-[15px] text-ui-muted">{error ? "Transfers appear here once the history service is reachable." : historySource ? <>No transfers yet. <Link href="/bridge" className="text-ui-lime-text hover:underline">Send one from the bridge.</Link></> : "Connect a history source to list transfers."}</p>}
          columns={[
            { key: "from", header: "From", render: (r) => <TableName icon={<ChainCoin chainId={r.srcChainId} size={30} />} title={short(r.sender)} sub={chainById(r.srcChainId).shortName} /> },
            { key: "amount", header: "Amount", align: "right", render: (r) => { const native = r.token === "0x0000000000000000000000000000000000000000"; return <Amount value={BigInt(r.gross)} decimals={native ? 18 : 6} symbol={native ? "ETH" : "USDC"} max={4} />; } },
            { key: "code", header: "Code", hideBelow: "md", render: (r) => <span className="ui-figure code-digits">{r.gross.slice(-4)}</span> },
            { key: "maker", header: "Maker", hideBelow: "lg", render: (r) => makerName(r.maker) },
            { key: "status", header: "Status", render: (r) => { const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status }; return <Pill tone={st.tone}>{st.label}</Pill>; } },
            { key: "when", header: "When", align: "right", hideBelow: "sm", render: (r) => <span className="text-ui-muted">{ago(r.timestamp)}</span> },
          ]}
        />
      </PanelCard>
    </div>
  );
}
