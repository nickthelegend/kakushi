"use client";

import { Card, PrimaryButton, StatusPill } from "@kakushi/ui";
import { Check, Store } from "lucide-react";
import Link from "next/link";
import { Glass } from "@/components/app/glass";
import { Rise } from "@/components/motion";
import { makers } from "./content";
import { SectionIntro, Shell } from "./section";

/** For Makers: fees, margin, timelocked withdrawals. */
export function Makers() {
  return (
    <section id="makers" aria-labelledby="makers-title" className="scroll-mt-24 py-20 lg:py-28">
      <Shell className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <Rise y={32} blur={8} className="relative order-2 lg:order-1">
          <Glass art="coin-purple" size={220} className="absolute -top-10 -left-6 -z-10 w-[150px] rotate-[-12deg] opacity-90" />
          <Card padding="lg" className="ring-1 ring-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-[19px] font-medium tracking-[-0.02em]">Maker B</h3>
              <StatusPill tone="lime" size="sm">online</StatusPill>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["Margin on Monad", "2,000 USDC"],
                ["Required", "550 USDC"],
                ["p50 payout", "≈450 ms"],
                ["Slashed", "0"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[18px] bg-ui-canvas p-4">
                  <p className="text-[13px] text-ui-muted">{k}</p>
                  <p className="ui-figure mt-1 text-[22px] font-medium tracking-[-0.03em]">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-[14px]">
              {["Sepolia → Monad · 0.15% + 0.03", "Monad → Sepolia · 0.15% + 0.40", "Sepolia → Base · 0.25% + 0.0001 ETH"].map((r) => (
                <div key={r} className="flex items-center justify-between rounded-full bg-ui-canvas px-4 py-2.5">
                  <span>{r.split(" · ")[0]}</span>
                  <span className="ui-figure text-ui-muted">{r.split(" · ")[1]}</span>
                </div>
              ))}
            </div>
          </Card>
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
