"use client";

import { Check } from "lucide-react";
import { Rise } from "@/components/motion";
import { hero } from "./content";
import { ProductPreview } from "./preview";
import { SectionIntro, Shell } from "./section";

/** Right under the coins: what a transfer is, shown as one. */
export function Transfer() {
  return (
    <section aria-labelledby="transfer-title" className="py-16 lg:py-24">
      <Shell>
        <SectionIntro id="transfer-title" align="center" eyebrow="One transfer" heading={["Pay a Maker.", "Get paid on the other chain."]} sub={hero.sub} className="mx-auto max-w-[820px]" />
        <Rise y={40} blur={8} duration={1} amount={0.08} className="mt-12">
          <ProductPreview />
          <p className="mt-4 text-center text-[13px] text-ui-muted">An illustration of a real transfer, priced with the published fee formula.</p>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-ui-muted">
            {hero.trust.map((t) => (
              <li key={t} className="inline-flex items-center gap-2">
                <Check aria-hidden size={15} strokeWidth={2.25} className="text-ui-lime-text" />
                {t}
              </li>
            ))}
          </ul>
        </Rise>
      </Shell>
    </section>
  );
}
