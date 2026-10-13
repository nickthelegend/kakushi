"use client";

import { CHAIN_LIST, CHAINS, chainById } from "@kakushi/config";
import { Card, PrimaryButton, StatusPill } from "@kakushi/ui";
import { Check, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback } from "react";
import { formatUnits, zeroAddress, type Hex } from "viem";
import { Glass } from "@/components/app/glass";
import { Rise } from "@/components/motion";
import { short } from "@/components/kit";
import { useIndexer } from "@/lib/engage";
import { pendingChains } from "@/lib/routes";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";
import { makers } from "./content";
import { SectionIntro, Shell } from "./section";

interface LiveMaker {
  address: Hex;
  name: string;
  online: boolean | null;
  margin: bigint;
  required: bigint | null;
  routes: { key: string; label: string; fee: string }[];
}

const usdc = (v: bigint) => Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The best-backed registered Maker, read from Monad (MDC, EBC) and the Maker's own health check. No made-up figures. */
function LiveMakerCard() {
  const { k, cfg } = useRuntime();
  const load = useCallback(async (): Promise<LiveMaker | null> => {
    const all = await k!.makers();
    if (!all.length) return null;
    const read = await Promise.all(all.map(async (address) => ({ address, ...(await k!.margin(address, CHAINS.monadTestnet.usdc.address)) })));
    const best = read.sort((a, b) => (b.margin > a.margin ? 1 : b.margin < a.margin ? -1 : 0))[0]!;
    const idx = cfg!.makers.findIndex((m) => m.address.toLowerCase() === best.address.toLowerCase());
    let online: boolean | null = null;
    if (idx >= 0) online = await fetch(`/api/svc/maker-${idx}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
    // only routes between chains that are deployed and funded (a pair to a pending chain can't fill)
    const pending = new Set(pendingChains(cfg!.deployments).map((key) => CHAINS[key].chainId));
    const live = (id: number) => CHAIN_LIST.some((c) => c.chainId === id) && !pending.has(id);
    const pairs = (await k!.pairs(best.address)).filter((p) => p.active && live(p.srcChainId) && live(p.dstChainId));
    const routes = pairs.map((p) => {
      const native = p.srcToken === zeroAddress;
      const fee = `${Number(p.tradingFeeBps) / 100}% + ${Number(formatUnits(p.withholdingFee, p.srcDecimals))}${native ? " ETH" : ""}`;
      return { key: p.pairId, label: `${chainById(p.srcChainId).shortName} → ${chainById(p.dstChainId).shortName}${native ? " · ETH" : ""}`, fee };
    });
    return { address: best.address, name: idx >= 0 ? cfg!.makers[idx]!.name : short(best.address), online, margin: best.margin, required: best.required, routes };
  }, [k, cfg]);
  const { data, error, loading } = usePoll(k && cfg ? load : null, 30000, [k, cfg]);
  const { data: idx } = useIndexer<{ items: { maker: string; p50LatencyMs: number | null; disputesLost: number }[] }>(data ? "makers" : null, 30000);
  const stats = data ? idx?.items.find((m) => m.maker.toLowerCase() === data.address.toLowerCase()) : undefined;
  const p50 = stats?.p50LatencyMs;
  return (
    <Card padding="lg" className="relative z-10 mx-3 -mt-12 ring-1 ring-ui-hairline-strong sm:mx-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[19px] font-medium tracking-[-0.02em]">{data ? data.name : "Live Maker"}</h3>
        {data ? <StatusPill tone={data.online ? "lime" : "neutral"} size="sm">{data.online ? "online" : data.online === false ? "offline" : "registered"}</StatusPill> : null}
      </div>
      {!data ? (
        <p className="mt-4 text-[15px] text-ui-muted">{loading || (!error && !cfg) ? "Reading Monad…" : error ? "Can't read the hub right now." : "No Maker registered yet."}</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-ui-muted">Live from Monad testnet</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              ["Margin on Monad", `${usdc(data.margin)} USDC`],
              ["Required", data.required === null ? "—" : `${usdc(data.required)} USDC`],
              ["Typical payout", p50 == null ? "—" : `${(p50 / 1000).toFixed(0)} s`],
              ["Slashed", stats ? String(stats.disputesLost) : "—"],
            ].map(([key, v]) => (
              <div key={key} className="rounded-[18px] bg-ui-canvas p-4">
                <p className="text-[13px] text-ui-muted">{key}</p>
                <p className="ui-figure mt-1 text-[22px] font-medium tracking-[-0.03em]">{v}</p>
              </div>
            ))}
          </div>
          {data.routes.length ? (
            <div className="mt-4 grid gap-2 text-[14px]">
              {data.routes.slice(0, 4).map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 rounded-full bg-ui-canvas px-4 py-2.5">
                  <span>{r.label}</span>
                  <span className="ui-figure text-ui-muted">{r.fee}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** For Makers: fees, margin, timelocked withdrawals. */
export function Makers() {
  return (
    <section id="makers" aria-labelledby="makers-title" className="scroll-mt-24 py-20 lg:py-28">
      <Shell className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <Rise y={32} blur={8} className="relative order-2 grid lg:order-1">
          <div className="relative overflow-hidden rounded-[28px] ring-1 ring-ui-hairline-strong">
            <Image src="/art/vault.webp" alt="" width={1254} height={1254} sizes="(min-width: 1024px) 600px, 100vw" className="h-[200px] w-full object-cover sm:h-[240px]" />
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,#04060f)]" />
            <Glass art="coin-gold" size={160} className="absolute right-5 bottom-4 w-[92px] rotate-[14deg]" />
          </div>
          <LiveMakerCard />
        </Rise>
        <div className="order-1 lg:order-2">
          <SectionIntro id="makers-title" eyebrow={makers.eyebrow} heading={makers.heading} sub={makers.sub} />
          <ul className="mt-8 grid gap-5">
            {makers.bullets.map((b, i) => (
              <Rise as="li" key={b.title} y={12} delay={0.2 + i * 0.08} className="flex gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-ui-surface-2 text-ui-lime">
                  <Check size={15} strokeWidth={2.25} aria-hidden />
                </span>
                <span>
                  <span className="block text-[17px] font-medium">{b.title}</span>
                  <span className="mt-0.5 block text-[15px] text-ui-muted">{b.body}</span>
                </span>
              </Rise>
            ))}
          </ul>
          <Rise y={12} delay={0.4} className="mt-8">
            <PrimaryButton asChild size="lg" icon={<Store />}>
              <Link href="/maker">Open the Maker console</Link>
            </PrimaryButton>
          </Rise>
        </div>
      </Shell>
    </section>
  );
}
