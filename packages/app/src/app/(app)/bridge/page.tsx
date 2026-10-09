"use client";

import { Menu, PrimaryButton, StatusPill, cn } from "@kakushi/ui";
import { ArrowDown, ArrowRight, ChevronDown, Gavel, Info, Settings2, ShieldCheck, Timer, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Hex } from "viem";
import { CHAINS, chainById, chainByIdentCode, type ChainKey } from "@kakushi/config";
import { buildTransferTx, erc20Abi, type MakerQuote } from "@kakushi/sdk";
import { AssetCoin, ChainCoin } from "@/components/coins";
import { readError } from "@/components/kit";
import { ConnectButton } from "@/components/AppShell";
import { ROUTES, routesFor, tokenOf, type Route } from "@/lib/routes";
import { maximumPrincipal, parseBridgeAmount, requireSuccessfulReceipt } from "@/lib/bridge-state";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";
import { statusPill, useWatched, ZERO } from "@/lib/useWatched";
import { useWallet } from "@/lib/wallet";

const short = (a: string, n = 4) => `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
const fmt = (v: bigint, d: number, max = 2) => {
  const [i, f = ""] = formatUnits(v, d).split(".");
  return `${Number(i).toLocaleString("en-US")}${max ? `.${f.slice(0, max).padEnd(Math.min(2, max), "0")}` : ""}`;
};
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/** The route that best keeps what the user just picked, falling back to the first live one. */
function pickRoute(routes: Route[], want: Partial<Pick<Route, "src" | "dst" | "asset">>, current: Route): Route {
  const score = (r: Route) => (want.src && r.src === want.src ? 4 : 0) + (want.dst && r.dst === want.dst ? 4 : 0) + (want.asset && r.asset === want.asset ? 4 : 0) + (r.src === current.src ? 1 : 0) + (r.dst === current.dst ? 1 : 0) + (r.asset === current.asset ? 1 : 0);
  return [...routes].sort((a, b) => score(b) - score(a))[0]!;
}

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

/* ── pickers ──────────────────────────────────────────────────────────────── */

function ChainPicker({ label, value, options, onPick }: { label: string; value: ChainKey; options: ChainKey[]; onPick: (k: ChainKey) => void }) {
  return (
    <Menu
      label={label}
      width={240}
      trigger={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ui-surface-2 pr-2.5 pl-1 text-[13px] font-medium transition-colors hover:bg-ui-surface-3">
          <ChainCoin chainId={CHAINS[value].chainId} size={24} />
          {CHAINS[value].shortName}
          <ChevronDown aria-hidden size={14} className="text-ui-muted" />
        </span>
      }
    >
      {options.map((k) => (
        <Menu.Item key={k} icon={<ChainCoin chainId={CHAINS[k].chainId} size={22} />} onSelect={() => onPick(k)}>
          {CHAINS[k].shortName}
        </Menu.Item>
      ))}
    </Menu>
  );
}

function AssetPicker({ value, chain, assets, onPick }: { value: Route["asset"]; chain: ChainKey; assets: Route["asset"][]; onPick: (a: Route["asset"]) => void }) {
  return (
    <Menu
      label="Token"
      align="end"
      width={220}
      trigger={
        <span className="inline-flex h-11 items-center gap-2 rounded-full bg-ui-surface-2 pr-3 pl-1.5 transition-colors hover:bg-ui-surface-3">
          <span className="relative">
            <AssetCoin asset={value} size={32} />
            <span className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-ui-surface-2">
              <ChainCoin chainId={CHAINS[chain].chainId} size={14} />
            </span>
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[15px] font-semibold">{value}</span>
            <span className="block text-[11px] text-ui-muted">{CHAINS[chain].shortName}</span>
          </span>
          <ChevronDown aria-hidden size={15} className="text-ui-muted" />
        </span>
      }
    >
      {assets.map((a) => (
        <Menu.Item key={a} icon={<AssetCoin asset={a} size={22} />} onSelect={() => onPick(a)} description={a === "USDC" ? "Circle USDC" : "Native ether"}>
          {a}
        </Menu.Item>
      ))}
    </Menu>
  );
}

/* ── the card ─────────────────────────────────────────────────────────────── */

function BridgeCard({ routes, route, setRoute }: { routes: Route[]; route: Route; setRoute: (r: Route) => void }) {
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
  const reverse = routes.find((r) => r.src === route.dst && r.dst === route.src && r.asset === route.asset);
  const srcOptions = [...new Set(routes.map((r) => r.src))];
  const dstOptions = [...new Set(routes.filter((r) => r.src === route.src && r.asset === route.asset).map((r) => r.dst))];
  const assetOptions = [...new Set(routes.filter((r) => r.src === route.src).map((r) => r.asset))];
  const dp = route.asset === "ETH" ? 6 : 2;

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

  const reason = error ? "Not live on this network yet" : !w.address ? null : qErr ?? (q && !q.quotable ? q.reason : null);
  const cta = sending ?? (!w.address ? "Connect a wallet to bridge" : insufficient ? `Not enough ${route.asset}` : !amount ? "Enter an amount" : q ? `Bridge ${fmt(BigInt(q.principal), src.decimals, route.asset === "ETH" ? 4 : 2)} ${route.asset}` : loadingQ ? "Finding a Maker…" : "Bridge");

  return (
    <div className="rounded-[30px] bg-[#0b0f1f]/75 p-3 shadow-[0_50px_120px_-40px_rgb(47_71_245/0.55)] ring-1 ring-white/10 backdrop-blur-xl">
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-3">
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-ui-surface-2 px-3.5 py-1.5 text-[14px] font-medium">Bridge</span>
          <Link href="/disputes" className="rounded-full px-3.5 py-1.5 text-[14px] text-ui-muted hover:text-ui-text">Claim</Link>
        </div>
        <Menu
          label="Settings"
          align="end"
          width={300}
          trigger={
            <span className="grid size-9 place-items-center rounded-full text-ui-muted transition-colors hover:bg-ui-surface-2 hover:text-ui-text">
              <Settings2 aria-hidden size={18} />
            </span>
          }
        >
          <Menu.Item onSelect={() => setCustom((c) => !c)} description="Deliver to another address on the destination chain.">
            {custom ? "✓ " : ""}Send to a different address
          </Menu.Item>
        </Menu>
      </div>

      {/* From */}
      <div className="rounded-[22px] bg-[#04060f]/80 p-5 ring-1 ring-white/[0.04]">
        <div className="flex items-center justify-between text-[13px] text-ui-muted">
          <span className="flex items-center gap-2">
            From <ChainPicker label="Source chain" value={route.src} options={srcOptions} onPick={(s) => setRoute(pickRoute(routes, { src: s }, route))} />
          </span>
          <button
            type="button"
            disabled={balance === null}
            onClick={() => balance !== null && setAmountStr(formatUnits(maximumPrincipal(balance, CHAINS[route.dst].identCode, route.asset === "ETH" ? parseUnits("0.001", 18) : 0n), src.decimals))}
            className="ui-figure hover:text-ui-text disabled:hover:text-ui-muted"
          >
            Balance {balance === null ? "—" : fmt(balance, src.decimals, route.asset === "ETH" ? 4 : 2)}
            {balance !== null ? <span className="ml-1.5 font-semibold text-ui-lime-text">Max</span> : null}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            aria-label={`Amount of ${route.asset} to send`}
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            className={cn("ui-figure min-w-0 flex-1 bg-transparent text-[40px] font-medium tracking-[-0.03em] outline-none placeholder:text-ui-dim", amountStr.trim() !== "" && amount === null && "text-ui-down")}
          />
          <AssetPicker value={route.asset} chain={route.src} assets={assetOptions} onPick={(a) => setRoute(pickRoute(routes, { asset: a, src: route.src }, route))} />
        </div>
      </div>

      <div className="relative z-10 -my-3.5 flex justify-center">
        <button
          type="button"
          aria-label="Swap direction"
          disabled={!reverse}
          onClick={() => reverse && setRoute(reverse)}
          className="grid size-11 place-items-center rounded-[15px] border-4 border-[#0b0f1f] bg-[#1a2142] text-ui-text transition-transform hover:rotate-180 disabled:opacity-40"
        >
          <ArrowDown aria-hidden size={17} />
        </button>
      </div>

      {/* To */}
      <div className="rounded-[22px] bg-[#04060f]/80 p-5 ring-1 ring-white/[0.04]">
        <div className="flex items-center justify-between text-[13px] text-ui-muted">
          <span className="flex items-center gap-2">
            To <ChainPicker label="Destination chain" value={route.dst} options={dstOptions} onPick={(d) => setRoute(pickRoute(routes, { src: route.src, dst: d }, route))} />
          </span>
          <span>{q ? `from ${q.name}` : null}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className={cn("ui-figure min-w-0 flex-1 truncate text-[40px] font-medium tracking-[-0.03em]", !q && "text-ui-dim")}>{q ? fmt(BigInt(q.net), src.decimals, dp) : loadingQ ? "…" : "0"}</span>
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-ui-surface-2 pr-4 pl-1.5">
            <span className="relative">
              <AssetCoin asset={route.asset} size={32} />
              <span className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-ui-surface-2">
                <ChainCoin chainId={CHAINS[route.dst].chainId} size={14} />
              </span>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold">{route.asset}</span>
              <span className="block text-[11px] text-ui-muted">{CHAINS[route.dst].shortName}</span>
            </span>
          </span>
        </div>
      </div>

      {custom ? (
        <input
          aria-label="Recipient address"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder={`Recipient on ${CHAINS[route.dst].shortName} (0x…)`}
          className={cn("mt-2 h-12 w-full rounded-[18px] bg-ui-canvas px-4 font-mono text-[13px] outline-none ring-1", recipient && !recipientOk ? "ring-ui-down" : "ring-ui-hairline")}
        />
      ) : null}

      {/* One line of quote; the rest behind Details */}
      <details className="group mt-2 px-3 py-2 text-[13px]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1.5 text-ui-muted [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1.5"><Timer aria-hidden size={14} /> <span className="ui-figure text-ui-text">{q ? `${(q.etaMs / 1000).toFixed(1)} s` : "≈1 s"}</span> · fee <span className="ui-figure text-ui-text">{q ? fmt(BigInt(q.withholdingFee) + BigInt(q.tradingFee), src.decimals, route.asset === "ETH" ? 5 : 3) : "—"}</span></span>
          <span className="inline-flex items-center gap-1">Details <ChevronDown aria-hidden size={13} className="transition-transform group-open:rotate-180" /></span>
        </summary>
        <dl className="mt-2 grid gap-2.5 border-t border-ui-hairline pt-3">
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1.5 text-ui-muted"><Users aria-hidden size={14} /> Maker</dt>
            <dd>
              <Menu
                label="Choose a Maker"
                align="end"
                width={340}
                trigger={<span className={cn("inline-flex items-center gap-1 font-medium hover:text-ui-lime-text", !quotes?.length && "pointer-events-none text-ui-muted")}>{q ? q.name : "Best quote"}<ChevronDown aria-hidden size={13} /></span>}
              >
                {quotes?.map((x) => (
                  <Menu.Item key={x.maker} disabled={!x.quotable} onSelect={() => setChosen(x.maker)} description={x.quotable ? `Fee ${fmt(BigInt(x.withholdingFee) + BigInt(x.tradingFee), src.decimals, 4)} · margin ${fmt(BigInt(x.margin), 6, 0)} USDC` : x.reason}>
                    {x.name}: {fmt(BigInt(x.net), src.decimals, 4)} {route.asset}
                  </Menu.Item>
                ))}
              </Menu>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1.5 text-ui-muted"><ShieldCheck aria-hidden size={14} /> Margin</dt>
            <dd className="ui-figure">{q ? `${fmt(BigInt(q.margin), 6, 0)} USDC` : "—"}</dd>
          </div>
          {gross !== null ? (
            <div className="flex items-center justify-between">
              <dt className="text-ui-muted">Wallet sends</dt>
              <dd className="ui-figure">{fixed.slice(0, -4)}<span className="code-digits">{fixed.slice(-4)}</span></dd>
            </div>
          ) : null}
          {cfg?.deployments?.hub?.fillWindow ? (
            <div className="flex items-center justify-between">
              <dt className="text-ui-muted">Fill window</dt>
              <dd className="ui-figure">{cfg.deployments.hub.fillWindow} s, then margin pays</dd>
            </div>
          ) : null}
        </dl>
      </details>

      {sendErr ? <p role="alert" className="px-3 pb-2 text-[13px] text-ui-down">{sendErr}</p> : null}
      {w.address ? (
        <PrimaryButton size="lg" block className="h-[58px] text-[17px] shadow-[0_14px_40px_-12px_rgb(47_71_245/0.8)]" disabled={!q?.quotable || insufficient || !recipientOk || !!sending} onClick={send}>
          {cta}
        </PrimaryButton>
      ) : (
        <ConnectButton block large />
      )}
      {reason ? (
        <p className="flex gap-2 px-3 pt-3 pb-1 text-[13px] leading-snug text-ui-muted">
          <Info aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/* ── recent transfers, under the card ─────────────────────────────────────── */

function Recent() {
  const { cfg } = useRuntime();
  const { data, error } = useWatched();
  const router = useRouter();
  if (error || !data?.length) return null;
  const name = (a: string) => cfg?.makers.find((m) => m.address.toLowerCase() === a.toLowerCase())?.name ?? short(a);
  return (
    <section aria-labelledby="recent-title" className="mt-8">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id="recent-title" className="text-[15px] font-medium">Recent transfers</h2>
        <Link href="/explorer" className="inline-flex items-center gap-1 text-[13px] text-ui-muted hover:text-ui-text">All <ArrowRight aria-hidden size={13} /></Link>
      </div>
      <ul className="grid gap-1.5">
        {[...data].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5).map((r) => {
          const native = r.token === ZERO;
          const st = statusPill(r.status);
          const code = Number(r.gross.slice(-4));
          return (
            <li key={r.srcRef + r.maker}>
              <button type="button" onClick={() => router.push(`/tx/${r.srcChainId}/${r.txHash}`)} className="flex w-full items-center gap-3 rounded-[18px] bg-ui-surface-1 px-3.5 py-3 text-left ring-1 ring-ui-hairline transition-colors hover:bg-ui-surface-2">
                <span className="flex items-center -space-x-1.5">
                  <ChainCoin chainId={r.srcChainId} size={24} />
                  <ChainCoin chainId={chainByIdentCode(code)?.chainId ?? r.srcChainId} size={24} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ui-figure block text-[14px] font-medium">{fmt(BigInt(r.gross), native ? 18 : 6, native ? 4 : 2)} {native ? "ETH" : "USDC"}</span>
                  <span className="block truncate text-[12px] text-ui-muted">{chainById(r.srcChainId).shortName} → {chainByIdentCode(code)?.shortName ?? "?"} · {name(r.maker)} · {ago(r.timestamp)}</span>
                </span>
                <StatusPill tone={st.tone} size="sm">{st.text}</StatusPill>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function BridgePage() {
  const { cfg } = useRuntime();
  const routes = useMemo(() => routesFor(cfg?.deployments), [cfg]);
  const [picked, setRoute] = useState<Route>(ROUTES[0]!);
  const route = routes.some((r) => r.id === picked.id) ? picked : routes[0]!;
  return (
    <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[7vh]">
      <h1 className="sr-only">Bridge</h1>
      <button
        type="button"
        onClick={() => setRoute(pickRoute(routes, { src: "sepolia", dst: "monadTestnet", asset: "USDC" }, route))}
        className="mb-4 flex w-full items-center justify-between gap-3 rounded-full bg-[linear-gradient(90deg,#16205a,#0b0f1f)] py-1.5 pr-4 pl-1.5 ring-1 ring-ui-hairline-strong"
      >
        <span className="inline-flex items-center gap-2 rounded-full bg-ui-surface-2 py-1 pr-3 pl-1 text-[13px] font-medium">
          <AssetCoin asset="USDC" size={22} /> USDC
        </span>
        <span aria-hidden className="h-px flex-1 bg-[linear-gradient(90deg,transparent,#8ea5ff,transparent)]" />
        <span className="inline-flex items-center gap-2 text-[14px] font-medium">
          <ChainCoin chainId={10143} size={22} /> Monad in ≈1 s
        </span>
      </button>
      <BridgeCard routes={routes} route={route} setRoute={setRoute} />
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-ui-muted">
        <Gavel aria-hidden size={13} /> Maker didn&rsquo;t pay? <Link href="/disputes" className="text-ui-lime-text hover:underline">Claim it from their margin</Link>
      </p>
      <Recent />
    </div>
  );
}
