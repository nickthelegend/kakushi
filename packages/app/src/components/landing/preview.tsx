"use client";

import { BalanceSummaryCard, Money, PrimaryButton, StatusPill, SwapCard, SwapStack, SwapToggle } from "@kakushi/ui";
import { Check, Send, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetCoin, ChainCoin } from "@/components/coins";
import { DrawLine, Rise, useReveal } from "@/components/motion";

/**
 * The hero's product preview: the bridge widget with a quote worked out by the published fee
 * formula (Maker B's example route: 0.15% plus 0.03 USDC), beside a transfer's timeline.
 * An illustration, labelled as one; the live widget is at /bridge.
 */
const WITHHOLD = 0.03;
const BPS = 15;

export function ProductPreview() {
  const [amount, setAmount] = useState("25");
  const q = useMemo(() => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) return null;
    const principal = Math.floor(v * 100) / 100;
    const base = principal - WITHHOLD;
    const net = base - (base * BPS) / 10_000;
    return { principal, net, gross: `${principal.toFixed(2)}9001`, fees: principal - net };
  }, [amount]);
  const [ref, seen] = useReveal<HTMLOListElement>(0.3);
  const steps = [
    { t: "Paid on Sepolia", s: "25.009001 USDC to Maker B", tag: "0.0 s", tone: "neutral" as const },
    { t: "The hub classifies it", s: "Maker B owes you 24.93 USDC on Monad", tag: "rules", tone: "teal" as const },
    { t: "Paid out on Monad", s: "Through the PayoutRouter", tag: "≈1 s", tone: "lime" as const },
    { t: "Attested by Chainlink CRE", s: "In a contiguous block window", tag: "CRE", tone: "purple" as const },
  ];
  return (
    <div className="grid gap-4 rounded-[28px] bg-ui-surface-1/50 p-3 ring-1 ring-white/6 sm:p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="rounded-[22px] bg-ui-canvas p-5 sm:p-7">
        <div className="flex items-center justify-between">
          <p className="text-[19px] font-medium tracking-[-0.02em]">Transfer</p>
          <StatusPill tone="lime" size="sm">Settled</StatusPill>
        </div>
        <ol ref={ref} className="relative mt-5 grid gap-1">
          <DrawLine play={seen} axis="y" duration={1.2} className="absolute top-3 bottom-3 left-[15px] w-px bg-ui-hairline-strong" />
          {steps.map((s, i) => (
            <Rise key={s.t} as="li" y={12} delay={0.15 + i * 0.14} play={seen} className="relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-4 py-3">
              <span className={`relative z-10 grid size-8 place-items-center rounded-full ${i === 2 ? "bg-ui-lime-button text-[#121418]" : "bg-ui-surface-2 text-ui-text"}`}>
                <Check size={15} strokeWidth={2.5} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-medium">{s.t}</span>
                <span className="mt-0.5 block text-[14px] text-ui-muted">{s.s}</span>
              </span>
              <StatusPill tone={s.tone} size="sm" className="ui-figure mt-0.5 h-6 px-2.5 text-[12px]">{s.tag}</StatusPill>
            </Rise>
          ))}
        </ol>
        <div className="mt-5 rounded-[18px] bg-ui-surface-1 p-4">
          <p className="text-[13px] text-ui-muted">The exact amount the wallet sent</p>
          <p className="ui-figure mt-1 text-[24px] font-medium tracking-[-0.03em]">
            25.00<span className="code-digits">9001</span> <span className="text-[15px] text-ui-muted">USDC</span>
          </p>
          <p className="mt-1 text-[13px] text-ui-muted">The last four digits route it: 9001 is Monad.</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-[22px] bg-ui-canvas p-3 sm:p-4">
        <SwapStack
          top={<SwapCard coin={<AssetCoin asset="USDC" size={42} />} symbol="USDC" caption="You send on Sepolia" value={amount} onValueChange={setAmount} inputLabel="Example amount" metaLabel="Code" meta="9001" />}
          toggle={<SwapToggle label="Reverse" disabled />}
          bottom={<SwapCard coin={<ChainCoin chainId={10143} size={42} />} symbol="USDC" caption="You receive on Monad" amount={q ? q.net.toFixed(2) : "0.00"} metaLabel="From" meta="Maker B" />}
        />
        <PrimaryButton size="lg" block icon={<Send />} asChild>
          <a href="/bridge">{q ? `Send ${q.principal.toFixed(2)} USDC` : "Send"}</a>
        </PrimaryButton>
        <BalanceSummaryCard
          label="Backed by margin on Monad"
          value={<Money value={2000} />}
          badge={<StatusPill tone="lime" size="sm" icon={<ShieldCheck size={13} />}>slashable</StatusPill>}
          stats={[
            { label: "Fees", value: q ? q.fees.toFixed(4) : "—" },
            { label: "You receive", value: q ? q.net.toFixed(2) : "—" },
            { label: "Settles in", value: "≈1 s" },
          ]}
        />
      </div>
    </div>
  );
}
