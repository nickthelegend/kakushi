"use client";

import {
  BalanceSummaryCard,
  DataTable,
  DeltaChip,
  GradientLineChart,
  Menu,
  Money,
  PairHeader,
  PanelCard,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
  SwapCard,
  SwapStack,
  SwapToggle,
  TableName,
  TextTabs,
  TimeframeChips,
  cn,
} from "@kakushi/ui";
import { ArrowRight, Gavel, Info, Send, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Hex } from "viem";
import { CHAINS, chainById, chainByIdentCode } from "@kakushi/config";
import { buildTransferTx, erc20Abi, type MakerQuote } from "@kakushi/sdk";
import { AssetCoin, ChainCoin } from "@/components/coins";
import { readError } from "@/components/kit";
import { ROUTES, tokenOf, type Route } from "@/lib/routes";
import { maximumPrincipal, parseBridgeAmount, requireSuccessfulReceipt } from "@/lib/bridge-state";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";
import { statusPill, useWatched, ZERO, type WatchedRow } from "@/lib/useWatched";
import { useWallet } from "@/lib/wallet";

type Frame = "1h" | "24h" | "1w";
const FRAME_SEC: Record<Frame, number> = { "1h": 3600, "24h": 86400, "1w": 604800 };
const FRAME_SUFFIX: Record<Frame, string> = { "1h": "this hour", "24h": "today", "1w": "this week" };

const routeTitle = (r: Route) => `${r.asset} / ${CHAINS[r.src].shortName} → ${CHAINS[r.dst].shortName}`;
const short = (a: string, n = 4) => `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
const fmt = (v: bigint, d: number, max = 2) => {
  const s = formatUnits(v, d);
  const [i, f = ""] = s.split(".");
  return `${Number(i).toLocaleString("en-US")}${f ? `.${f.slice(0, max).padEnd(Math.min(2, max), "0")}` : max ? ".00" : ""}`;
};
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/* ── the chart: volume bridged on this route ──────────────────────────────── */

function VolumeChart({ route, setRoute, rows, error }: { route: Route; setRoute: (id: string) => void; rows: WatchedRow[] | null; error: string | null }) {
  const [frame, setFrame] = useState<Frame>("24h");
  const dec = tokenOf(route, "src").decimals;
  const series = useMemo(() => {
    if (!rows) return null;
    const now = Math.floor(Date.now() / 1000);
    const from = now - FRAME_SEC[frame];
    const token = tokenOf(route, "src").address.toLowerCase();
    const mine = rows
      .filter((r) => r.srcChainId === CHAINS[route.src].chainId && r.token.toLowerCase() === token && r.timestamp >= from && r.status !== "no-obligation")
      .sort((a, b) => a.timestamp - b.timestamp);
    let acc = 0;
    const points = [{ t: from * 1000, value: 0 }];
    for (const r of mine) {
      acc += Number(formatUnits(BigInt(r.gross), dec));
      points.push({ t: r.timestamp * 1000, value: acc });
    }
    if (mine.length) points.push({ t: now * 1000, value: acc });
    const prevFrom = from - FRAME_SEC[frame];
    const prev = rows.filter((r) => r.srcChainId === CHAINS[route.src].chainId && r.token.toLowerCase() === token && r.timestamp >= prevFrom && r.timestamp < from).length;
    const delta = prev === 0 ? null : ((mine.length - prev) / prev) * 100;
    return { total: acc, count: mine.length, points: mine.length ? points : [], delta };
  }, [rows, route, frame, dec]);
  const time = (t: string | number | Date) => {
    const d = new Date(t);
    return frame === "1w" ? d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric" }) : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  return (
    <section aria-label="Bridged volume" className="min-w-0">
      <PairHeader
        coins={[<ChainCoin key="s" chainId={CHAINS[route.src].chainId} size={50} />, <AssetCoin key="a" asset={route.asset} size={50} />]}
        title={routeTitle(route)}
        options={ROUTES.map((r) => ({ value: r.id, label: routeTitle(r), description: r.asset === "USDC" ? "Circle USDC, both directions" : "Native ETH, Sepolia and Base Sepolia" }))}
        value={route.id}
        onValueChange={setRoute}
        menuLabel="Choose a route"
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {series ? (
            <>
              <span className="ui-figure text-[36px] leading-none font-medium tracking-[-0.035em] sm:text-[44px]" title={`Bridged ${FRAME_SUFFIX[frame]}`}>
                {route.asset === "USDC" ? <Money value={series.total} /> : `${series.total.toFixed(4)} ETH`}
              </span>
              <DeltaChip value={series.delta} suffix={series.delta === null ? undefined : FRAME_SUFFIX[frame]} label={series.delta === null ? (series.count ? `${series.count} transfers` : "No transfers yet") : undefined} />
            </>
          ) : error ? null : (
            <Skeleton width={260} height={44} />
          )}
        </div>
        <TimeframeChips options={["1h", "24h", "1w"] as const} value={frame} onValueChange={setFrame} aria-label="Timeframe" />
      </div>
      <div className="mt-6">
        {error && !rows ? (
          <div className="grid h-[340px] place-items-center rounded-ui-card border border-ui-hairline text-center">
            <div className="max-w-sm px-6">
              <p className="text-[15px] text-ui-text">Transfer history comes from the Watchtower.</p>
              <p className="mt-1 text-[14px] text-ui-muted">{readError(error)}</p>
            </div>
          </div>
        ) : !series ? (
          <Skeleton shape="card" height={340} />
        ) : (
          <GradientLineChart
            key={`${route.id}-${frame}`}
            label={`${route.asset} bridged ${FRAME_SUFFIX[frame]}, running total`}
            data={series.points}
            height={340}
            formatValue={(v) => (route.asset === "USDC" ? `$${v.toFixed(2)}` : `${v.toFixed(4)} ETH`)}
            formatAxis={(v) => v.toLocaleString("en-US", { maximumFractionDigits: route.asset === "USDC" ? 2 : 4 })}
            formatTime={time}
            formatBubbleNote={null}
            lastLabel="Now"
            empty={<p className="text-[15px] text-ui-muted">No transfers on this route {FRAME_SUFFIX[frame]}. Your first one draws this line.</p>}
          />
        )}
      </div>
    </section>
  );
}

/* ── the table: recent transfers ──────────────────────────────────────────── */

function RecentTransfers({ rows, error }: { rows: WatchedRow[] | null; error: string | null }) {
  const router = useRouter();
  const { cfg } = useRuntime();
  const list = useMemo(() => (rows ? [...rows].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8) : []), [rows]);
  const makerName = (a: string) => cfg?.makers.find((m) => m.address.toLowerCase() === a.toLowerCase())?.name ?? short(a);
  return (
    <section aria-label="Recent transfers" className="min-w-0">
      <DataTable
        caption="Recent transfers"
        loading={!rows && !error}
        loadingRows={4}
        rows={list}
        rowKey={(r) => r.srcRef + r.maker}
        onRowClick={(r) => router.push(`/tx/${r.srcChainId}/${r.txHash}`)}
        empty={<p className="py-10 text-center text-[15px] text-ui-muted">{error ? "Transfer history is unavailable until the Watchtower is reachable." : "No transfers yet. Send one with the panel on the right."}</p>}
        columns={[
          { key: "from", header: "From", render: (r) => <TableName icon={<ChainCoin chainId={r.srcChainId} size={30} />} title={short(r.sender)} sub={chainById(r.srcChainId).shortName} /> },
          { key: "maker", header: "Maker", hideBelow: "lg", render: (r) => makerName(r.maker) },
          {
            key: "amount",
            header: "Amount",
            render: (r) => {
              const native = r.token === ZERO;
              const g = BigInt(r.gross);
              return (
                <span className="ui-figure">
                  {fmt(g, native ? 18 : 6, native ? 4 : 2)} <span className="text-ui-muted">{native ? "ETH" : "USDC"}</span>
                  <span className="ml-1.5 text-[13px] code-digits">{r.gross.slice(-4)}</span>
                </span>
              );
            },
          },
          { key: "status", header: "Status", hideBelow: "sm", render: (r) => { const p = statusPill(r.status); return <StatusPill tone={p.tone}>{p.text}</StatusPill>; } },
          { key: "when", header: "When", hideBelow: "md", render: (r) => <span className="text-ui-muted">{ago(r.timestamp)}</span> },
        ]}
      />
      <div className="mt-3 flex items-center justify-end">
        <Link href="/activity" className="inline-flex h-10 items-center gap-1.5 rounded-full px-1 text-[15px] text-ui-muted transition-colors hover:text-ui-lime-active">
          All transfers <ArrowRight aria-hidden size={16} strokeWidth={1.75} />
        </Link>
      </div>
    </section>
  );
}

/* ── the widget: send, or prove a missed payout ───────────────────────────── */

function useBalance(route: Route, who: Hex | null) {
  const { k } = useRuntime();
  const t = tokenOf(route, "src");
  const poll = usePoll(
    k && who
      ? async () => {
          const c = k.client(route.src);
          return t.address === zeroAddress ? c.getBalance({ address: who }) : ((await c.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [who] })) as bigint);
        }
      : null,
    6000,
    [k, who, route],
  );
  return poll.error ? null : poll.data;
}

function SendWidget({ route, setRoute }: { route: Route; setRoute: (id: string) => void }) {
  const { k, cfg, makerUrls, error } = useRuntime();
  const w = useWallet();
  const router = useRouter();
  const src = tokenOf(route, "src");
  const [amountStr, setAmountStr] = useState("25");
  const [custom, setCustom] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [quotes, setQuotes] = useState<MakerQuote[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [qErr, setQErr] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const balance = useBalance(route, w.address);
  const amount = useMemo(() => parseBridgeAmount(amountStr, src.decimals), [amountStr, src.decimals]);

  useEffect(() => {
    setQuotes(null);
    if (!k || !amount) return;
    let live = true;
    setLoadingQ(true);
    setQErr(null);
    const t = setTimeout(async () => {
      try {
        const qs = await k.quote({ srcChainId: CHAINS[route.src].chainId, dstChainId: CHAINS[route.dst].chainId, token: route.asset === "USDC" ? "USDC" : "NATIVE", amount, makerUrls });
        if (!live) return;
        setQuotes(qs);
        setChosen((c) => (c && qs.some((q) => q.maker === c && q.quotable) ? c : (qs.find((q) => q.quotable)?.maker ?? null)));
        if (qs.length === 0) setQErr("No Maker is online for this route right now.");
      } catch (e) {
        if (live) setQErr(readError((e as Error).message));
      } finally {
        if (live) setLoadingQ(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [k, amount, route, makerUrls]);

  const q = quotes?.find((x) => x.maker === chosen) ?? null;
  const gross = q ? BigInt(q.gross) : null;
  const recipientOk = !custom || isAddress(recipient);
  const insufficient = gross !== null && balance !== null && balance < gross;
  const fixed = gross !== null ? (() => { const s = gross.toString().padStart(src.decimals + 1, "0"); return `${s.slice(0, -src.decimals)}.${s.slice(-src.decimals)}`; })() : "";
  const reverse = ROUTES.find((r) => r.src === route.dst && r.dst === route.src && r.asset === route.asset);

  async function send() {
    if (!k || !q?.quotable || !w.address || gross === null || sending || !recipientOk || insufficient) return;
    setSendErr(null);
    setSending("Preparing…");
    try {
      const tx = buildTransferTx(k, { srcChainId: CHAINS[route.src].chainId, token: src.address, maker: q.maker, gross, sender: w.address, recipient: custom ? (recipient as Hex) : undefined });
      const wc = await w.walletClient(route.src);
      const pc = k.client(route.src);
      if (tx.approve) {
        setSending("Approving…");
        const ah = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: tx.approve.token, abi: erc20Abi, functionName: "approve", args: [tx.approve.spender, tx.approve.amount] });
        requireSuccessfulReceipt(await pc.waitForTransactionReceipt({ hash: ah }), "Approval");
      }
      setSending("Confirm in your wallet…");
      const hash = await wc.sendTransaction({ chain: wc.chain, account: wc.account!, to: tx.to, data: tx.data, value: tx.value ?? 0n });
      setSending("Waiting for the source chain…");
      requireSuccessfulReceipt(await pc.waitForTransactionReceipt({ hash }), "Payment");
      router.push(`/tx/${CHAINS[route.src].chainId}/${hash}`);
    } catch (e) {
      setSendErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
      setSending(null);
    }
  }

  const reason = error ? "Kakushi isn't deployed on this network yet." : !w.address ? "Connect a wallet to send." : qErr ?? (q && !q.quotable ? q.reason : null);
  return (
    <div className="flex flex-col gap-3">
      <SwapStack
        top={
          <SwapCard
            coin={<AssetCoin asset={route.asset} size={42} />}
            symbol={`${route.asset}`}
            caption={`You send on ${CHAINS[route.src].shortName}`}
            value={amountStr}
            onValueChange={setAmountStr}
            inputLabel={`Amount of ${route.asset} to send`}
            invalid={amountStr.trim() !== "" && amount === null}
            metaLabel="Balance"
            meta={
              <button type="button" disabled={balance === null} onClick={() => balance !== null && setAmountStr(formatUnits(maximumPrincipal(balance, CHAINS[route.dst].identCode, route.asset === "ETH" ? parseUnits("0.001", 18) : 0n), src.decimals))} className="rounded-[6px] underline-offset-4 hover:underline disabled:no-underline">
                {balance === null ? "—" : fmt(balance, src.decimals, route.asset === "ETH" ? 4 : 2)}
              </button>
            }
          />
        }
        toggle={<SwapToggle label={reverse ? `Reverse: ${routeTitle(reverse)}` : "Reverse"} onClick={() => reverse && setRoute(reverse.id)} disabled={!reverse} />}
        bottom={
          <SwapCard
            coin={<ChainCoin chainId={CHAINS[route.dst].chainId} size={42} />}
            symbol={route.asset}
            caption={`${custom ? "They receive" : "You receive"} on ${CHAINS[route.dst].shortName}`}
            amount={q ? fmt(BigInt(q.net), src.decimals, route.asset === "ETH" ? 6 : 2) : loadingQ ? "…" : "0.00"}
            metaLabel="From"
            meta={q ? q.name : "—"}
          />
        }
      />

      {sendErr ? <p role="alert" className="px-1 text-[14px] text-ui-down">{sendErr}</p> : null}
      <PrimaryButton size="lg" block className="mt-1" icon={<Send />} disabled={!q?.quotable || !w.address || insufficient || !recipientOk || !!sending} onClick={send}>
        {sending ?? (insufficient ? `Not enough ${route.asset}` : q ? `Send ${fmt(BigInt(q.principal), src.decimals, route.asset === "ETH" ? 4 : 2)} ${route.asset}` : "Send")}
      </PrimaryButton>

      <Menu
        label="Choose a Maker"
        align="end"
        width={380}
        triggerClassName="w-full"
        trigger={
          <span className={cn("inline-flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full bg-ui-surface-1 px-7 text-[16px] font-medium transition-colors hover:bg-ui-surface-2", !quotes?.length && "opacity-50")}>
            {q ? `Maker: ${q.name}` : "Choose a Maker"}
            <Users aria-hidden size={18} strokeWidth={1.75} />
          </span>
        }
      >
        {quotes?.map((x) => (
          <Menu.Item key={x.maker} disabled={!x.quotable} onSelect={() => setChosen(x.maker)} description={x.quotable ? `Fees ${fmt(BigInt(x.withholdingFee) + BigInt(x.tradingFee), src.decimals, 4)} · margin ${fmt(BigInt(x.margin), 6, 0)} USDC` : x.reason}>
            {x.name}: {fmt(BigInt(x.net), src.decimals, 4)} {route.asset}
          </Menu.Item>
        ))}
      </Menu>

      {reason ? (
        <p className="flex gap-2 px-1 text-[13px] leading-snug text-ui-muted">
          <Info aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          {reason}
        </p>
      ) : null}

      {gross !== null ? (
        <PanelCard variant="outline" title="Exact amount your wallet sends" subtitle={`The last four digits are the destination: ${gross.toString().slice(-4)} is ${chainByIdentCode(Number(gross.toString().slice(-4)))?.shortName ?? "unknown"}.`}>
          <p className="ui-figure mt-1 text-[22px] font-medium tracking-[-0.02em] break-all">
            {fixed.slice(0, -4)}
            <span className="code-digits">{fixed.slice(-4)}</span> <span className="text-[15px] text-ui-muted">{route.asset}</span>
          </p>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ui-muted">
            <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="accent-[#b0c956]" />
            Pay to a different address on {CHAINS[route.dst].shortName}
          </label>
          {custom ? (
            <input aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x… recipient" className={cn("mt-2 h-11 w-full rounded-full border bg-ui-surface-1 px-4 font-mono text-[13px] outline-none", recipient && !recipientOk ? "border-ui-down" : "border-ui-hairline-strong")} />
          ) : null}
        </PanelCard>
      ) : null}

      <BalanceSummaryCard
        label="Backed by margin on Monad"
        value={q ? <Money value={Number(formatUnits(BigInt(q.margin), 6))} /> : "—"}
        badge={q ? <StatusPill tone="lime" size="sm" icon={<ShieldCheck size={13} />}>slashable</StatusPill> : undefined}
        stats={[
          { label: "Fees", value: q ? `${fmt(BigInt(q.withholdingFee) + BigInt(q.tradingFee), src.decimals, 4)}` : "—" },
          { label: "You receive", value: q ? fmt(BigInt(q.net), src.decimals, route.asset === "ETH" ? 6 : 2) : "—" },
          { label: "Settles in", value: q ? `${(q.etaMs / 1000).toFixed(1)} s` : "—" },
        ]}
      />
      <p className="px-1 text-[12px] text-ui-muted">Fill window {cfg?.deployments?.hub?.fillWindow ?? "…"} s. A missed payout is proven and paid from this margin.</p>
    </div>
  );
}

function ProveWidget() {
  return (
    <div className="flex flex-col gap-3">
      <PanelCard variant="filled" title="A Maker didn't pay?" subtitle="Anyone can prove it. Your browser rebuilds the Chainlink CRE attested windows and proves, in Noir, that your payment exists and no payout does. Monad slashes the Maker's margin to you in the same transaction.">
        <ul className="mt-2 grid gap-2 text-[14px] text-ui-muted">
          <li>1. Paste your source transaction</li>
          <li>2. Generate the proof in your browser</li>
          <li>3. Submit it on Monad and get the full amount</li>
        </ul>
      </PanelCard>
      <PrimaryButton asChild size="lg" block icon={<Gavel />}>
        <Link href="/disputes">Prove a missed payout</Link>
      </PrimaryButton>
      <SecondaryButton asChild size="lg" block iconRight={<ShieldCheck />}>
        <Link href="/attestations">See the attestations</Link>
      </SecondaryButton>
    </div>
  );
}

export default function BridgePage() {
  const [routeId, setRouteId] = useState(ROUTES[0]!.id);
  const [tab, setTab] = useState<"send" | "prove">("send");
  const route = ROUTES.find((r) => r.id === routeId)!;
  const watched = useWatched();
  return (
    <>
      <h1 className="sr-only">Bridge</h1>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_356px] xl:grid-cols-[minmax(0,1fr)_404px] xl:gap-x-11">
        <div className="lg:col-start-1 lg:row-start-1">
          <VolumeChart route={route} setRoute={setRouteId} rows={watched.data} error={watched.error} />
        </div>
        <div className="order-first lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TextTabs options={[{ value: "send", label: "Send" }, { value: "prove", label: "Prove" }] as const} value={tab} onValueChange={setTab} aria-label="Bridge actions" className="mb-4" />
          {tab === "send" ? <SendWidget route={route} setRoute={setRouteId} /> : <ProveWidget />}
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <RecentTransfers rows={watched.data} error={watched.error} />
        </div>
      </div>
    </>
  );
}
