"use client";

import { Button } from "@kakushi/ui";
import { Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BlurWords, Rise } from "@/components/motion";
import { hero } from "./content";

/** The hero: a blue pill, the serif headline, one line on what it is, Open app (white) and the developer path, and the struck coins (a Gemini render with the real marks). */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[70%] bg-[radial-gradient(60%_70%_at_50%_85%,rgb(47_71_245/0.22),transparent_70%)]" />
      <div className="mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-12 text-center sm:px-6 sm:pt-16 lg:pt-20">
        <Rise y={8} blur={4} duration={0.6}>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a5cf0] px-3 text-[13px] font-medium text-white">
            <Star aria-hidden className="size-3.5 fill-current" strokeWidth={0} />
            {hero.pill}
          </span>
        </Rise>
        <h1 id="hero-title" aria-label={hero.headline.join(" ")} className="mt-5 text-[clamp(46px,7.4vw,108px)] leading-[1.02] text-balance">
          <BlurWords as="span" css text={hero.headline[0]!} className="block" lineClassName="block" delay={0.05} />
          <BlurWords as="span" css text={hero.headline[1]!} className="block" lineClassName="block" delay={0.3} />
        </h1>
        <Rise y={10} delay={0.25} duration={0.6} className="mt-5 max-w-[34ch] sm:mt-6">
          <p className="text-[16px] leading-snug text-ui-muted sm:text-[18px]">{hero.line}</p>
        </Rise>
        <Rise y={12} delay={0.35} duration={0.6} className="mt-7 flex flex-wrap items-center justify-center gap-3 sm:mt-9">
          <Button asChild variant="white" size="md" className="h-12 px-6 text-[16px] font-medium">
            <Link href="/send">{hero.primary}</Link>
          </Button>
          <Button asChild variant="outline" size="md" className="h-12 border-white/40 px-6 text-[16px] font-medium">
            <Link href="/developers">{hero.secondary}</Link>
          </Button>
        </Rise>
      </div>
      <div className="relative mt-2 h-[46vh] min-h-[300px] w-full overflow-hidden sm:h-[52vh] lg:h-[58vh] lg:max-h-[640px]">
        <Image src="/art/coins.webp" alt="Metal coins struck with the Kakushi, USDC, Ethereum, Monad and Base marks" fill priority sizes="100vw" className="coin-drift object-cover object-[50%_62%]" />
        <div aria-hidden className="coin-sweep absolute inset-0 mix-blend-screen" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-[38%] bg-[linear-gradient(var(--ui-canvas),transparent)]" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(transparent,var(--ui-canvas))]" />
    </section>
  );
}
