"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRightLeft, Clock, Shield, Zap } from "lucide-react";
import { formatUnits, parseUnits, zeroAddress, isAddress, type Hex } from "viem";
import { CHAINS, chainByIdentCode } from "@kakushi/config";
import { buildTransferTx, erc20Abi, type MakerQuote } from "@kakushi/sdk";
import { Amount, Button, ChainDot, Notice, Spinner, cn } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { ROUTES, tokenOf, type Route } from "@/lib/routes";
import { usePoll } from "@/lib/usePoll";
import { maximumPrincipal, parseBridgeAmount, requireSuccessfulReceipt } from "@/lib/bridge-state";

/** v as a fixed-point string with all `d` decimals (so the code is always the last 4 chars). */
function toFixed(v: bigint, d: number): string {
  const s = v.toString().padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

function useBalance(route: Route, who: Hex | null): bigint | null {
  const { k } = useRuntime();
  const t = tokenOf(route, "src");
  const poll = usePoll(k && who ? async () => {
    const c = k.client(route.src);
    return t.address === zeroAddress ? c.getBalance({ address: who }) : c.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
  } : null, 6000, [k, who, route]);
  return poll.error ? null : poll.data;
}

export default function BridgePage() {
  const { k, cfg, makerUrls, error } = useRuntime();
  const w = useWallet();
  const router = useRouter();
  const [routeId, setRouteId] = useState(ROUTES[0]!.id);
  const route = ROUTES.find((r) => r.id === routeId)!;
  const src = tokenOf(route, "src");
  const [amountStr, setAmountStr] = useState("5");
  const [custom, setCustom] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [quoteState, setQuoteState] = useState<{ key: string; runtime: typeof k; quotes: MakerQuote[] } | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const balance = useBalance(route, w.address);

  const amount = useMemo(() => parseBridgeAmount(amountStr, src.decimals), [amountStr, src.decimals]);
  const quoteKey = `${route.id}:${amount}`;
  const quotes = quoteState?.key === quoteKey && quoteState.runtime === k ? quoteState.quotes : null;

  useEffect(() => {
    if (!k || !amount) { setQuoteState(null); setLoadingQ(false); setQErr(null); return; }
    let live = true;
    setLoadingQ(true);
    setQErr(null);
    const t = setTimeout(async () => {
      try {
        const qs = await k.quote({ srcChainId: CHAINS[route.src].chainId, dstChainId: CHAINS[route.dst].chainId, token: route.asset === "USDC" ? "USDC" : "NATIVE", amount, makerUrls });
        if (!live) return;
        setQuoteState({ key: quoteKey, runtime: k, quotes: qs });
        setChosen((c) => (c && qs.some((q) => q.maker === c && q.quotable) ? c : (qs.find((q) => q.quotable)?.maker ?? null)));
        if (qs.length === 0) setQErr("No Maker is online for this route.");
      } catch (e) {
        if (live) setQErr((e as Error).message);
      } finally {
        if (live) setLoadingQ(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [k, amount, route, makerUrls, quoteKey]);

  const q = quotes?.find((x) => x.maker === chosen) ?? null;
  const gross = q ? BigInt(q.gross) : null;
  const recipientOk = !custom || isAddress(recipient);
  const insufficient = gross !== null && balance !== null && balance < gross;

  async function send() {
    if (!k || !q?.quotable || !w.address || gross === null || sending || !recipientOk || insufficient) return;
    setSending("Preparing the payment…");
    setSendErr(null);
    try {
      const tx = buildTransferTx(k, { srcChainId: CHAINS[route.src].chainId, token: src.address, maker: q.maker, gross, sender: w.address, recipient: custom ? (recipient as Hex) : undefined });
      const wc = await w.walletClient(route.src);
      const pc = k.client(route.src);
      if (tx.approve) {
        setSending("Approving the SourceRouter…");
        const ah = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: tx.approve.token, abi: erc20Abi, functionName: "approve", args: [tx.approve.spender, tx.approve.amount] });
        requireSuccessfulReceipt(await pc.waitForTransactionReceipt({ hash: ah }), "Approval");
      }
      setSending("Confirm the payment in your wallet…");
      const hash = await wc.sendTransaction({ chain: wc.chain, account: wc.account!, to: tx.to, data: tx.data, value: tx.value ?? 0n });
      setSending("Waiting for the source chain…");
      requireSuccessfulReceipt(await pc.waitForTransactionReceipt({ hash }), "Source payment");
      router.push(`/tx/${CHAINS[route.src].chainId}/${hash}`);
    } catch (e) {
      setSendErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
      setSending(null);
    }
  }

  const codeDigits = gross !== null ? gross.toString().slice(-4) : "";
  const fixed = gross !== null ? toFixed(gross, src.decimals) : "";

  const dstName = CHAINS[route.dst].shortName;
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="font-display text-4xl font-bold sm:text-5xl">Send across</h1>
        <p className="mt-3 max-w-xl text-[15px] text-muted">You pay a Maker directly and it pays you on the other side. If it doesn't, its margin on Monad does.</p>
        {error && <div className="mt-4"><Notice tone="bad">{error}</Notice></div>}

        <div className="mt-8 flex flex-wrap gap-x-1 gap-y-2 border-b border-line" role="tablist" aria-label="Route">
          {ROUTES.map((r) => (
            <button key={r.id} role="tab" aria-selected={r.id === routeId} onClick={() => setRouteId(r.id)} className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-3 text-sm transition", r.id === routeId ? "border-washi text-text" : "border-transparent text-muted hover:text-text")}>
              <ChainDot chainId={CHAINS[r.src].chainId} size={8} /> {CHAINS[r.src].shortName}
              <ArrowRightLeft className="size-3.5 opacity-40" />
              <ChainDot chainId={CHAINS[r.dst].chainId} size={8} /> {CHAINS[r.dst].shortName}
              <span className="text-dim">{r.asset}</span>
            </button>
          ))}
        </div>

        <section className="mt-6 rounded-[18px] border border-line bg-s1/70 backdrop-blur-sm" aria-label="Transfer slip">
          <div className="p-6">
            <div className="flex items-center justify-between text-sm text-muted">
              <label htmlFor="amount">You send on {CHAINS[route.src].shortName}</label>
              {w.address && (
                <button className="tabular hover:text-text" onClick={() => balance !== null && setAmountStr(formatUnits(maximumPrincipal(balance, CHAINS[route.dst].identCode, route.asset === "ETH" ? parseUnits("0.001", 18) : 0n), src.decimals))}>
                  Use balance: {balance === null ? "…" : <Amount value={balance} decimals={src.decimals} max={4} />}
                </button>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <input id="amount" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="w-full min-w-0 bg-transparent font-display text-[clamp(40px,7vw,64px)] font-bold leading-none outline-none tabular placeholder:text-dim" placeholder="0" />
              <span className="shrink-0 text-lg text-muted">{src.symbol}</span>
            </div>
            {amountStr && amount === null && <p className="mt-2 text-sm text-warn">Enter a positive amount with at most {src.decimals} decimals.</p>}
          </div>

          <div className="relative border-t border-dashed border-line-strong p-6">
            <span className="absolute -top-3 left-6 grid size-6 place-items-center rounded-full border border-line-strong bg-bg text-muted"><ArrowDown className="size-3.5" /></span>
            <div className="text-sm text-muted">{custom ? "The recipient receives" : "You receive"} on {dstName}</div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="w-full font-display text-[clamp(40px,7vw,64px)] font-bold leading-none tabular">
                {q ? <Amount value={BigInt(q.net)} decimals={src.decimals} max={6} /> : <span className="text-dim" aria-label={loadingQ ? "Getting quotes" : "No quote available"}>{loadingQ ? "…" : "—"}</span>}
              </div>
              <span className="shrink-0 text-lg text-muted">{tokenOf(route, "dst").symbol}</span>
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="accent-[#93b2ee]" />
              Send to a different address
            </label>
            {custom && (
              <input aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x… recipient on the destination chain" className={cn("mt-2 w-full rounded-[10px] border bg-bg px-3 py-2.5 font-mono text-sm outline-none", recipient && !recipientOk ? "border-bad" : "border-line")} />
            )}
          </div>

          {gross !== null && (
            <div className="border-t border-dashed border-line-strong p-6">
              <div className="text-sm text-muted">The exact amount your wallet sends</div>
              <div className="mt-2 font-display text-2xl font-bold break-all tabular sm:text-3xl">
                {fixed.slice(0, -4)}
                <span key={codeDigits} className="seal seal-in ml-0.5 inline-block">{fixed.slice(-4)}</span>
                <span className="ml-2 font-sans text-base font-medium text-muted">{src.symbol}</span>
              </div>
              <p className="mt-3 max-w-xl text-sm text-muted">
                {codeDigits} is {chainByIdentCode(Number(codeDigits))?.shortName ?? "an unknown chain"}'s code. {custom ? "A different recipient goes through the SourceRouter, which needs an approval first for USDC." : "It goes to the Maker as a plain transfer, with no approval."}
              </p>
            </div>
          )}

          <div className="border-t border-line p-6">
            {sendErr && <div className="mb-3"><Notice tone="bad">{sendErr}</Notice></div>}
            {!w.address ? (
              <p className="text-sm text-muted">Connect a wallet to send.</p>
            ) : (
              <Button className="h-14 w-full text-base" disabled={!q || !q.quotable || insufficient || !recipientOk || !!sending} loading={!!sending} onClick={send}>
                {sending ?? (insufficient ? `Not enough ${src.symbol}` : q ? `Pay ${q.name}` : "No quote yet")}
              </Button>
            )}
          </div>
        </section>
      </div>

      <aside className="lg:pt-[148px]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Makers</h2>
          {loadingQ && <Spinner />}
        </div>
        {qErr && <div className="mt-3"><Notice tone="warn">{qErr}</Notice></div>}
        {!quotes && !qErr && <p className="mt-3 text-sm text-muted">{error ? "Quotes are unavailable until Kakushi is deployed." : !cfg ? "Loading the bridge configuration…" : loadingQ ? "Asking Makers for quotes…" : "Enter an amount to see quotes."}</p>}
        <ol className="mt-3 divide-y divide-line border-y border-line">
          {quotes?.map((x, i) => (
            <li key={x.maker}>
              <button disabled={!x.quotable} onClick={() => setChosen(x.maker)} className={cn("w-full py-4 pl-3 text-left transition border-l-2", x.maker === chosen ? "border-washi" : "border-transparent hover:border-line-strong", !x.quotable && "opacity-50")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{i === 0 && x.quotable ? "Best: " : ""}{x.name}</span>
                  <span className="font-display text-lg font-bold tabular"><Amount value={BigInt(x.net)} decimals={src.decimals} /></span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  {x.quotable ? (
                    <>Fees <Amount value={BigInt(x.withholdingFee) + BigInt(x.tradingFee)} decimals={src.decimals} />, backed by <Amount value={BigInt(x.margin)} decimals={6} max={0} /> USDC on Monad</>
                  ) : (
                    <span className="text-warn">{x.reason}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ol>
        <dl className="mt-8 space-y-4 text-sm">
          <div className="flex gap-3"><Zap className="mt-0.5 size-4 shrink-0 text-muted" /><div><dt className="text-text">Fast</dt><dd className="text-muted">The Maker pays from its own inventory once your payment is final{q ? `, about ${(q.etaMs / 1000).toFixed(1)} s here` : ""}.</dd></div></div>
          <div className="flex gap-3"><Shield className="mt-0.5 size-4 shrink-0 text-indigo" /><div><dt className="text-text">Backed</dt><dd className="text-muted">Chainlink CRE attests every payout. A missing one is proven and paid from the Maker's margin.</dd></div></div>
          <div className="flex gap-3"><Clock className="mt-0.5 size-4 shrink-0 text-muted" /><div><dt className="text-text">{cfg?.deployments?.hub?.fillWindow ?? "…"} second fill window</dt><dd className="text-muted">A mistyped code is refunded on the source chain, never lost.</dd></div></div>
        </dl>
      </aside>
    </div>
  );
}
