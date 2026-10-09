"use client";

import { PrimaryButton } from "@kakushi/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Glass } from "@/components/app/glass";
import { BlurWords, Rise } from "@/components/motion";
import { fees } from "./content";
import { Shell } from "./section";

/** Fees in one line. */
export function Fees() {
  return (
    <section id="fees" aria-labelledby="fees-title" className="scroll-mt-24 py-20 lg:py-28">
      <Shell>
        <div className="relative isolate overflow-hidden rounded-[32px] bg-ui-surface-1 px-6 py-14 ring-1 ring-ui-hairline-strong sm:px-12 lg:px-16 lg:py-20">
          <Glass art="coin-blue" size={200} className="absolute top-8 right-8 -z-10 hidden w-[132px] rotate-[14deg] opacity-90 md:block lg:top-10 lg:right-12 lg:w-[176px]" />
          <Rise y={10} blur={4} duration={0.6}>
            <p className="inline-flex h-7 items-center gap-2 rounded-full bg-ui-lime-chip px-3 text-[13px] font-medium text-ui-lime-active ring-1 ring-ui-hairline-strong">
              <span aria-hidden className="size-1.5 rounded-full bg-ui-lime" />
              {fees.eyebrow}
            </p>
          </Rise>
          <BlurWords id="fees-title" as="h2" text={fees.line} className="serif mt-5 text-[clamp(36px,5.2vw,76px)] leading-[1.04] text-balance md:pr-[150px] lg:pr-[200px]" />
          <Rise y={14} delay={0.3} className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <p className="max-w-[560px] text-[17px] leading-[1.5] text-ui-muted lg:text-[19px]">{fees.sub}</p>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <PrimaryButton asChild size="lg" iconRight={<ArrowRight />}>
                <Link href="/bridge">Open the bridge</Link>
              </PrimaryButton>
              <p className="text-[14px] text-ui-muted">{fees.compare}</p>
            </div>
          </Rise>
        </div>
      </Shell>
    </section>
  );
}
