"use client";

import { CHAINS, type ChainKey } from "@kakushi/config";
import { ArrowRight } from "lucide-react";
import { ChainCoin } from "@/components/coins";
import { Rise } from "@/components/motion";
import { ROUTES } from "@/lib/routes";
import { chains } from "./content";
import { SectionIntro, Shell } from "./section";

const KEYS = [...new Set(ROUTES.flatMap((r) => [r.src, r.dst]))].sort((a, b) => (a === "monadTestnet" ? -1 : b === "monadTestnet" ? 1 : 0)) as ChainKey[];

/** The figures Orbiter leads with, and the chains and routes as they are configured. */
export function Chains() {
  const stats = [
    { value: "1", label: "SDK call to go private" },
    { value: String(KEYS.length), label: "chains, one hub" },
    { value: "0", label: "custodians" },
    { value: "≈1 s", label: "private bridge to Monad" },
  ];
  return (
    <section id="chains" aria-labelledby="chains-title" className="scroll-mt-24 py-16 lg:py-24">
      <Shell>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[28px] bg-ui-hairline-strong ring-1 ring-ui-hairline-strong md:grid-cols-4">
          {stats.map((s, i) => (
            <Rise key={s.label} delay={0.06 * i} className="bg-ui-canvas px-6 py-7">
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <span className="serif block text-[clamp(36px,4vw,56px)] leading-none">{s.value}</span>
                <span aria-hidden className="mt-2 block text-[14px] text-ui-muted">{s.label}</span>
              </dd>
            </Rise>
          ))}
        </dl>

        <div className="mt-20 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <SectionIntro id="chains-title" eyebrow={chains.eyebrow} heading={chains.heading} sub={chains.sub} />
          <div className="grid gap-3 sm:grid-cols-2">
            {KEYS.map((k, i) => {
              const c = CHAINS[k];
              const out = ROUTES.filter((r) => r.src === k);
              const hub = k === "monadTestnet";
              return (
                <Rise key={k} delay={0.05 * i} className={hub ? "sm:col-span-2" : undefined}>
                  <article className="h-full rounded-[24px] bg-ui-surface-1 p-5 ring-1 ring-ui-hairline-strong">
                    <div className="flex items-center gap-3">
                      <ChainCoin chainId={c.chainId} size={40} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[17px] font-medium">{c.shortName}</h3>
                        <p className="text-[13px] text-ui-muted">{hub ? "Hub: pools, proofs and disputes" : "Spoke: pools and stealth payments"}</p>
                      </div>
                      <span className="ui-figure rounded-full bg-ui-lime-chip px-2.5 py-1 text-[12px] text-ui-lime-active" title="The last four digits of an amount sent here">
                        code {c.identCode}
                      </span>
                    </div>
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {out.map((r) => (
                        <li key={r.id} className="inline-flex items-center gap-1.5 rounded-full bg-ui-canvas px-2.5 py-1 text-[12px]">
                          {r.asset}
                          <ArrowRight aria-hidden size={12} className="text-ui-muted" />
                          <ChainCoin chainId={CHAINS[r.dst].chainId} size={14} />
                          {CHAINS[r.dst].shortName}
                        </li>
                      ))}
                    </ul>
                  </article>
                </Rise>
              );
            })}
          </div>
        </div>
      </Shell>
    </section>
  );
}
