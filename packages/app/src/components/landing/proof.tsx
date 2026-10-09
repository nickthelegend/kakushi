"use client";

import { Card, StatusPill } from "@kakushi/ui";
import { motion } from "motion/react";
import { CountUp, DrawLine, Rise, useReduced, useReveal } from "@/components/motion";
import { EASE_REVEAL } from "@/components/motion/tokens";
import { proof } from "./content";
import { SectionIntro, Shell } from "./section";

/** "A missed payout is proven, not argued": stats, the dispute flow, and what backs a Maker. */
export function Proof() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="relative isolate scroll-mt-24 overflow-hidden py-20 lg:py-28">
      <Shell className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <SectionIntro id="proof-title" eyebrow={proof.eyebrow} heading={proof.heading} sub={proof.sub} />
          <Stats />
          <Rise y={20} delay={0.2} className="mt-8 overflow-hidden rounded-[24px] ring-1 ring-white/6">
            <video className="aspect-video w-full object-cover" src="/art/proof-loop.mp4" poster="/art/proof-poster.jpg" autoPlay muted loop playsInline aria-label="A bridge of light; a stalled transfer is sealed and paid back" />
          </Rise>
        </div>
        <div className="grid content-start gap-4">
          <Flow />
          <MakerBacking />
        </div>
      </Shell>
    </section>
  );
}

function Stats() {
  const [ref, seen] = useReveal<HTMLDListElement>(0.4);
  return (
    <dl ref={ref} className="mt-10 grid grid-cols-3 gap-3">
      {proof.stats.map((s, i) => (
        <Rise key={s.label} delay={0.1 * i} className="rounded-[24px] border border-ui-hairline-strong p-4 sm:p-5">
          <dt className="sr-only">{s.label}</dt>
          <dd>
            <CountUp value={s.value} play={seen} duration={1.3} format={(n) => `${n.toFixed(s.decimals)}${"suffix" in s ? s.suffix : ""}`} className="ui-figure block text-[30px] leading-none font-medium tracking-[-0.04em] whitespace-nowrap text-ui-lime-active sm:text-[40px] lg:text-[30px] xl:text-[40px]" />
            <span aria-hidden className="mt-2 block text-[13px] leading-snug text-ui-muted sm:text-[14px]">{s.label}</span>
          </dd>
        </Rise>
      ))}
    </dl>
  );
}

function Flow() {
  const [ref, seen] = useReveal<HTMLOListElement>(0.3);
  return (
    <Card padding="lg" className="ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[19px] font-medium tracking-[-0.02em]">A Maker that doesn&rsquo;t pay</h3>
        <StatusPill tone="purple" size="sm">Noir · UltraHonk</StatusPill>
      </div>
      <ol ref={ref} className="relative mt-5 grid gap-1">
        <DrawLine play={seen} axis="y" duration={1.2} className="absolute top-3 bottom-3 left-[15px] w-px bg-ui-hairline-strong" />
        {proof.flow.map((step, i) => (
          <Rise key={step.title} as="li" y={12} delay={0.15 + i * 0.14} play={seen} className="relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-4 py-2.5">
            <span className={`relative z-10 grid size-8 place-items-center rounded-full text-[13px] font-semibold ${i === 3 ? "bg-ui-lime-button text-ui-on-lime" : "bg-ui-surface-2 text-ui-text"}`}>{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[16px] font-medium">{step.title}</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-ui-muted">{step.body}</span>
            </span>
            <StatusPill tone={i === 3 ? "lime" : i === 2 ? "purple" : i === 1 ? "amber" : "neutral"} size="sm" className="ui-figure mt-0.5 h-6 px-2.5 text-[12px]">{step.tag}</StatusPill>
          </Rise>
        ))}
      </ol>
    </Card>
  );
}

function MakerBacking() {
  const [ref, seen] = useReveal<HTMLUListElement>(0.3);
  const reduced = useReduced();
  return (
    <Card padding="lg" className="ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[19px] font-medium tracking-[-0.02em]">{proof.maker.title}</h3>
        <StatusPill tone="lime" size="sm">on Monad</StatusPill>
      </div>
      <ul ref={ref} className="mt-5 grid gap-3">
        {proof.maker.rows.map((r, i) => (
          <li key={r.text} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span>{r.text}</span>
              <span className="ui-figure shrink-0 font-medium text-ui-lime-text">{r.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ui-canvas">
              <motion.div className="h-full rounded-full bg-ui-lime-button" initial={{ width: 0 }} animate={{ width: seen ? `${r.pct}%` : 0 }} transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.1 + i * 0.1, ease: EASE_REVEAL }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[13px] leading-relaxed text-ui-muted">{proof.maker.note}</p>
    </Card>
  );
}
