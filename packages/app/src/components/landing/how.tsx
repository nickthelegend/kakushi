"use client";

import { StatusPill, cn } from "@kakushi/ui";
import { Check, Coins, Gavel, Send } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Rise, useReduced, useReveal } from "@/components/motion";
import { EASE_REVEAL } from "@/components/motion/tokens";
import { how } from "./content";
import { SectionIntro, Shell } from "./section";

/** "Three ways a transfer ends": a card per outcome, each with a small live visual. */
export function How() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24 py-20 lg:py-28">
      <Shell>
        <SectionIntro id="how-title" eyebrow={how.eyebrow} heading={how.heading} sub={how.sub} />
        <div className="mt-12 grid gap-4 md:grid-cols-3 lg:mt-16">
          {how.cards.map((card, i) => (
            <Rise key={card.key} delay={0.12 * i} className="h-full">
              <article className="flex h-full flex-col rounded-[30px] border border-ui-hairline-strong p-3">
                <div className="h-[236px] overflow-hidden rounded-[24px] bg-ui-surface-1">
                  {card.key === "pay" ? <PayVisual /> : card.key === "paid" ? <PaidVisual /> : <ProofVisual />}
                </div>
                <div className="flex flex-1 flex-col px-3 pt-5 pb-3">
                  <h3 className="flex items-center gap-2.5 text-[22px] font-medium tracking-[-0.025em]">
                    <span className={cn("grid size-8 place-items-center rounded-full text-white", card.key === "pay" ? "bg-[#2f47f5]" : card.key === "paid" ? "bg-[#c79a52]" : "bg-[#6d86e9]")}>
                      {card.key === "pay" ? <Send size={16} /> : card.key === "paid" ? <Coins size={16} /> : <Gavel size={16} />}
                    </span>
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-[1.5] text-ui-muted">{card.body}</p>
                  <p className="mt-auto pt-5 text-[14px] font-medium text-ui-text">{card.foot}</p>
                </div>
              </article>
            </Rise>
          ))}
        </div>
      </Shell>
    </section>
  );
}

/** The amount, its last four digits rolling into the destination code. */
function PayVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [digits, setDigits] = useState("0000");
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setDigits("9001");
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n > 12) {
        clearInterval(id);
        setDigits("9001");
        return;
      }
      setDigits(Array.from({ length: 4 }, (_, k) => (n > 4 + k * 2 ? "9001"[k] : String(Math.floor(Math.random() * 10)))).join(""));
    }, 70);
    return () => clearInterval(id);
  }, [seen, reduced]);
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-4 px-5">
      <p className="text-[14px] text-ui-muted">You send to Maker B</p>
      <p className="ui-figure text-[40px] leading-none font-medium tracking-[-0.04em]">
        100.00<span className="code-digits">{digits}</span>
      </p>
      <div className="flex items-center justify-between rounded-[18px] bg-ui-canvas px-4 py-3 text-[15px]">
        <span className="text-ui-muted">Code {digits}</span>
        <span className="font-medium">{digits === "9001" ? "Monad testnet" : "…"}</span>
      </div>
    </div>
  );
}

/** A bar runs to about a second and the payout turns Final. */
function PaidVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    if (!seen) return;
    const t = setTimeout(() => setPaid(true), reduced ? 0 : 1100);
    return () => clearTimeout(t);
  }, [seen, reduced]);
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-4 px-5">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-ui-muted">Maker B pays you on Monad</span>
        <span className="ui-figure text-[17px] font-medium">99.84</span>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-ui-canvas">
          <motion.div className="h-full rounded-full bg-ui-lime-button" initial={{ width: "0%" }} animate={{ width: seen ? "100%" : "0%" }} transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.25, ease: "linear" }} />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-ui-muted">
          <span>Your payment</span>
          <span className="ui-figure">≈1 s</span>
        </div>
      </div>
      <motion.div animate={{ opacity: paid ? 1 : 0.35, scale: paid ? 1 : 0.98 }} transition={{ duration: 0.35, ease: EASE_REVEAL }} className="flex items-center justify-between rounded-[18px] bg-ui-canvas px-4 py-3">
        <span className="flex items-center gap-2.5 text-[15px] font-medium">
          <span className={cn("grid size-7 place-items-center rounded-full", paid ? "bg-ui-lime-button text-ui-on-lime" : "bg-ui-surface-2 text-ui-muted")}>
            <Check size={15} strokeWidth={2.5} aria-hidden />
          </span>
          {paid ? "Paid to you" : "Filling"}
        </span>
        <StatusPill tone={paid ? "lime" : "neutral"} size="sm">{paid ? "Final" : "…"}</StatusPill>
      </motion.div>
    </div>
  );
}

/** Deadline passes, attestation lands, the proof slashes margin back. */
function ProofVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setStep(3);
    const timers = [1, 2, 3].map((n) => setTimeout(() => setStep(n), 300 + n * 550));
    return () => timers.forEach(clearTimeout);
  }, [seen, reduced]);
  const rows = ["No payout by the deadline", "Chainlink CRE attests the windows", "Noir proof verified on Monad"];
  return (
    <div ref={ref} className="flex h-full flex-col justify-between p-5">
      <ul className="grid gap-2.5">
        {rows.map((r, i) => (
          <li key={r} className={cn("flex items-center gap-2.5 text-[14px] transition-opacity", step > i ? "opacity-100" : "opacity-30")}>
            <span className={cn("grid size-6 place-items-center rounded-full", step > i ? "bg-ui-pill-purple text-ui-pill-purple-text" : "bg-ui-surface-2")}>
              <Check size={13} strokeWidth={2.5} aria-hidden />
            </span>
            {r}
          </li>
        ))}
      </ul>
      <div className={cn("flex items-center justify-between rounded-[18px] bg-ui-canvas px-4 py-3 text-[15px] font-medium transition-opacity", step >= 3 ? "opacity-100" : "opacity-35")}>
        <span>Paid from margin</span>
        <span className="ui-figure">12.009001</span>
      </div>
    </div>
  );
}
