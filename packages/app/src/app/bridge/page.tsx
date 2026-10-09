"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRightLeft, Clock, Shield, Zap } from "lucide-react";
import { formatUnits, parseUnits, zeroAddress, isAddress, type Hex } from "viem";
import { CHAINS, chainByIdentCode } from "@kakushi/config";
import { buildTransferTx, erc20Abi, type MakerQuote } from "@kakushi/sdk";
import { Amount, Button, Card, ChainDot, Notice, Pill, Spinner, cn, short, PageHeader } from "@/components/ui";
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

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <PageHeader title="Bridge" subtitle="Pay a Maker directly. They pay you on the other chain in seconds. If they don't, their margin on Monad is slashed back to you with a zero-knowledge proof." />
        {error && <Notice tone="bad">{error}</Notice>}
        <Card className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Route">
            {ROUTES.map((r) => (
              <button key={r.id} role="tab" aria-selected={r.id === routeId} onClick={() => setRouteId(r.id)} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition", r.id === routeId ? "border-accent/50 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>
                <ChainDot chainId={CHAINS[r.src].chainId} /> {CHAINS[r.src].shortName}
                <ArrowRightLeft className="size-3.5 opacity-50" />
                <ChainDot chainId={CHAINS[r.dst].chainId} /> {CHAINS[r.dst].shortName}
                <span className="text-dim">{r.asset}</span>
              </button>
            ))}
          </div>

          <div className="rounded-[20px] bg-s2 p-5">
            <div className="flex items-center justify-between text-sm text-muted">
              <span>You send on {CHAINS[route.src].shortName}</span>
              {w.address && (
                <button className="tabular hover:text-text" onClick={() => balance !== null && setAmountStr(formatUnits(maximumPrincipal(balance, CHAINS[route.dst].identCode, route.asset === "ETH" ? parseUnits("0.001", 18) : 0n), src.decimals))}>
                  Balance {balance === null ? "…" : <Amount value={balance} decimals={src.decimals} max={4} />}
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input inputMode="decimal" aria-label="Amount" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="w-full bg-transparent text-4xl font-semibold tracking-[-0.03em] outline-none tabular placeholder:text-dim" placeholder="0" />
              <span className="inline-flex items-center gap-2 rounded-full bg-s3 px-3 py-1.5 text-sm font-medium">
                <ChainDot chainId={CHAINS[route.src].chainId} /> {src.symbol}
              </span>
            </div>
          </div>

          {amountStr && amount === null && <Notice tone="warn">Enter a positive amount with at most {src.decimals} decimals.</Notice>}

          <div className="-my-2 flex justify-center">
            <span className="rounded-full border border-line bg-s1 p-2 text-muted">
              <ArrowDown className="size-4" />
            </span>
          </div>

          <div className="rounded-[20px] bg-s2 p-5">
            <div className="text-sm text-muted">{custom ? "Recipient receives" : "You receive"} on {CHAINS[route.dst].shortName}</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="w-full text-4xl font-semibold tracking-[-0.03em]">
                {q ? <Amount value={BigInt(q.net)} decimals={src.decimals} max={6} /> : <span className="text-dim" aria-label={loadingQ ? "Getting quotes" : "No quote available"}>{loadingQ ? "…" : "—"}</span>}
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-s3 px-3 py-1.5 text-sm font-medium">
                <ChainDot chainId={CHAINS[route.dst].chainId} /> {tokenOf(route, "dst").symbol}
              </span>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="accent-[#FF4D2E]" />
              Send to a different address (uses the SourceRouter)
            </label>
            {custom && (
              <input aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x… recipient on the destination chain" className={cn("mt-2 w-full rounded-xl border bg-s1 px-3 py-2.5 font-mono text-sm outline-none", recipient && !recipientOk ? "border-bad" : "border-line")} />
            )}
          </div>

          {gross !== null && (
            <div className="rounded-[20px] border border-line p-4">
              <div className="text-xs uppercase tracking-wider text-dim">Exact amount you transfer</div>
              <div className="mt-1 font-mono text-lg break-all tabular">
                {fixed.slice(0, -4)}
                <span className="rounded bg-accent-soft px-0.5 font-semibold text-accent">{fixed.slice(-4)}</span> {src.symbol}
              </div>
              <div className="mt-1 text-sm text-muted">
                The last four digits <span className="font-mono text-accent">{codeDigits}</span> route it to {chainByIdentCode(Number(codeDigits))?.shortName ?? "an unknown chain"}. {custom ? "The SourceRouter supports your chosen recipient; USDC requires an approval first." : "It is a plain transfer to the Maker: no approval."} No wrapped token.
              </div>
            </div>
          )}

          {sendErr && <Notice tone="bad">{sendErr}</Notice>}
          {!w.address ? (
            <Notice>Connect a wallet to send.</Notice>
          ) : (
            <Button className="h-14 w-full text-base" disabled={!q || !q.quotable || insufficient || !recipientOk || !!sending} loading={!!sending} onClick={send}>
              {sending ?? (insufficient ? `Not enough ${src.symbol}` : q ? `Send to ${q.name}` : "No quote")}
            </Button>
          )}
        </Card>
      </div>

      <aside className="space-y-4 lg:pt-[92px]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-medium">Makers</div>
            {loadingQ && <Spinner />}
          </div>
          {qErr && <Notice tone="warn">{qErr}</Notice>}
          {!quotes && !qErr && <div className="text-sm text-muted">{error ? "Quotes are unavailable until Kakushi is deployed." : !cfg ? "Loading bridge configuration…" : loadingQ ? "Getting quotes from Makers…" : "Enter an amount to get quotes."}</div>}
          <div className="space-y-2">
            {quotes?.map((x) => (
              <button key={x.maker} disabled={!x.quotable} onClick={() => setChosen(x.maker)} className={cn("w-full rounded-2xl border p-3 text-left transition", x.maker === chosen ? "border-accent/60 bg-accent-soft" : "border-line hover:bg-s2", !x.quotable && "opacity-55")}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{x.name}</span>
                  {x.quotable ? <Pill tone="ok">quotable</Pill> : <Pill tone="warn">{x.reason}</Pill>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                  <span className="text-muted">You get</span>
                  <span className="text-right tabular"><Amount value={BigInt(x.net)} decimals={src.decimals} /></span>
                  <span className="text-muted">Withholding</span>
                  <span className="text-right tabular"><Amount value={BigInt(x.withholdingFee)} decimals={src.decimals} /></span>
                  <span className="text-muted">Trading fee</span>
                  <span className="text-right tabular"><Amount value={BigInt(x.tradingFee)} decimals={src.decimals} /></span>
                  <span className="text-muted">Margin on Monad</span>
                  <span className="text-right tabular"><Amount value={BigInt(x.margin)} decimals={6} max={0} symbol="USDC" /></span>
                </div>
                <div className="mt-2 font-mono text-xs text-dim">{short(x.maker)}</div>
              </button>
            ))}
          </div>
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <div className="flex gap-3"><Zap className="mt-0.5 size-4 shrink-0 text-accent" /><span><b>Fast.</b> The Maker pays from its own inventory as soon as your payment is final{q ? `, about ${(q.etaMs / 1000).toFixed(1)} s on this route` : ""}.</span></div>
          <div className="flex gap-3"><Shield className="mt-0.5 size-4 shrink-0 text-indigo" /><span><b>Backed.</b> Every Maker locks margin on Monad. Chainlink CRE attests every payout; if yours is missing, a Noir proof slashes it back to you.</span></div>
          <div className="flex gap-3"><Clock className="mt-0.5 size-4 shrink-0 text-muted" /><span>Fill window {cfg?.deployments?.hub?.fillWindow ?? "…"} s · a mistyped code is refunded, never lost.</span></div>
        </Card>
      </aside>
    </div>
  );
}
