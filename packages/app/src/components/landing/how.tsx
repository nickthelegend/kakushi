"use client";

import { StatusPill, cn } from "@kakushi/ui";
import { Check, EyeOff, Repeat, Shield } from "lucide-react";
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
                      {card.key === "pay" ? <EyeOff size={16} /> : card.key === "paid" ? <Shield size={16} /> : <Repeat size={16} />}
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

const HEX = "0123456789abcdef";
const TARGET = "0x9f3c…e21a";

/** A meta-address turns into a one-time address that only the recipient can find. */
function PayVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [addr, setAddr] = useState("0x????…????");
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setAddr(TARGET);
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n > 14) {
        clearInterval(id);
        setAddr(TARGET);
        return;
      }
      setAddr(TARGET.split("").map((ch, k) => (ch === "…" || k < 2 || n > 4 + k ? ch : HEX[Math.floor(Math.random() * 16)])).join(""));
    }, 70);
    return () => clearInterval(id);
  }, [seen, reduced]);
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-3 px-5">
      <div className="rounded-[16px] bg-ui-canvas px-4 py-3">
        <p className="text-[12px] text-ui-muted">Pay to</p>
        <p className="mt-0.5 truncate font-mono text-[13px]">st:eth:0x02a1…7f9c</p>
      </div>
      <div className="flex justify-center text-ui-muted">↓</div>
      <div className="rounded-[16px] bg-[#101a4a] px-4 py-3 ring-1 ring-[#3b55ff]/40">
        <p className="text-[12px] text-[#c4d0ff]">Lands on</p>
        <p className="mt-0.5 font-mono text-[18px] font-medium">{addr}</p>
      </div>
      <p className="text-center text-[12px] text-ui-muted">New address every payment</p>
    </div>
  );
}

/** Deposit with a commitment, withdraw elsewhere with a proof. */
function PaidVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setStep(2);
    const t1 = setTimeout(() => setStep(1), 500);
    const t2 = setTimeout(() => setStep(2), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [seen, reduced]);
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-3 px-5">
      <div className="flex items-center justify-between rounded-[16px] bg-ui-canvas px-4 py-3 text-[14px]">
        <span className="text-ui-muted">Deposit</span>
        <span className="ui-figure font-medium">1 MON</span>
      </div>
      <motion.div animate={{ opacity: step >= 1 ? 1 : 0.3 }} className="flex items-center justify-center gap-2 text-[13px] text-[#f2c27a]">
        <span className="size-1.5 rounded-full bg-current" /> Pool of 1 MON deposits
      </motion.div>
      <motion.div animate={{ opacity: step >= 2 ? 1 : 0.35, scale: step >= 2 ? 1 : 0.98 }} transition={{ duration: 0.35, ease: EASE_REVEAL }} className="flex items-center justify-between rounded-[16px] bg-ui-canvas px-4 py-3">
        <span className="flex items-center gap-2 text-[14px]">
          <span className={cn("grid size-6 place-items-center rounded-full", step >= 2 ? "bg-ui-lime-button text-white" : "bg-ui-surface-2 text-ui-muted")}>
            <Check size={13} strokeWidth={2.5} aria-hidden />
          </span>
          Withdraw to a new wallet
        </span>
        <StatusPill tone={step >= 2 ? "lime" : "neutral"} size="sm">{step >= 2 ? "Proof ok" : "…"}</StatusPill>
      </motion.div>
    </div>
  );
}

/** Sepolia to Monad, delivered to a stealth address by a Maker. */
function ProofVisual() {
  const [ref, seen] = useReveal<HTMLDivElement>(0.5);
  const reduced = useReduced();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) return setStep(3);
    const timers = [1, 2, 3].map((n) => setTimeout(() => setStep(n), 300 + n * 500));
    return () => timers.forEach(clearTimeout);
  }, [seen, reduced]);
  const rows = ["25 USDC sent on Sepolia", "Maker pays on Monad", "To a stealth address"];
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-2.5 p-5">
      {rows.map((r, i) => (
        <div key={r} className={cn("flex items-center gap-2.5 rounded-[14px] bg-ui-canvas px-3.5 py-2.5 text-[14px] transition-opacity", step > i ? "opacity-100" : "opacity-30")}>
          <span className={cn("grid size-6 place-items-center rounded-full", step > i ? "bg-ui-pill-purple text-ui-pill-purple-text" : "bg-ui-surface-2")}>
            <Check size={13} strokeWidth={2.5} aria-hidden />
          </span>
          {r}
        </div>
      ))}
    </div>
  );
}
