"use client";

import { PrimaryButton, SecondaryButton, StatusPill } from "@kakushi/ui";
import { ArrowRight, Check, Gavel } from "lucide-react";
import Link from "next/link";
import { BlurWords, Rise } from "@/components/motion";
import { hero } from "./content";
import { ProductPreview } from "./preview";

/** The hero in ref E's language: the headline over the product itself. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate pt-4 pb-16 sm:pt-6 lg:pb-24">
      <div aria-hidden className="glow-lime absolute top-10 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2" />
      <div className="mx-auto flex max-w-[1280px] flex-col items-center px-4 text-center sm:px-6 lg:px-8">
        <Rise y={10} blur={6} duration={0.7}>
          <StatusPill tone="lime" size="md" icon={<span className="block size-2 rounded-full bg-current" />}>
            {hero.eyebrow} · disputes settle on Monad
          </StatusPill>
        </Rise>
        <h1 id="hero-title" aria-label={hero.headline.join(" ")} className="mt-6 text-[clamp(44px,5vw,72px)] leading-[0.98] font-medium tracking-[-0.05em] text-balance">
          <BlurWords as="span" css text={hero.headline[0]!} className="block" lineClassName="block" delay={0.05} />
          <BlurWords as="span" css text={hero.headline[1]!} className="block text-ui-lime-active" lineClassName="block" delay={0.3} />
        </h1>
        <Rise y={16} blur={8} delay={0.45} duration={0.8}>
          <p className="mt-5 max-w-[640px] text-[17px] leading-[1.5] text-ui-muted sm:text-[19px]">{hero.sub}</p>
        </Rise>
        <Rise y={16} delay={0.6} duration={0.8} className="mt-7 flex flex-wrap justify-center gap-3">
          <PrimaryButton asChild size="lg" iconRight={<ArrowRight />}>
            <Link href="/bridge">{hero.primary}</Link>
          </PrimaryButton>
          <SecondaryButton asChild size="lg" icon={<Gavel />}>
            <Link href="/disputes">{hero.secondary}</Link>
          </SecondaryButton>
        </Rise>
      </div>
      <Rise y={48} blur={10} delay={0.55} duration={1.1} amount={0.04} className="mx-auto mt-9 max-w-[1280px] px-4 sm:px-6 lg:mt-12 lg:px-8">
        <ProductPreview />
        <p className="mt-4 text-center text-[13px] text-ui-muted">An illustration of a real transfer, priced with the published fee formula. The live bridge is one click away.</p>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-ui-muted">
          {hero.trust.map((t) => (
            <li key={t} className="inline-flex items-center gap-2">
              <Check aria-hidden size={15} strokeWidth={2.25} className="text-ui-lime-text" />
              {t}
            </li>
          ))}
        </ul>
      </Rise>
    </section>
  );
}
