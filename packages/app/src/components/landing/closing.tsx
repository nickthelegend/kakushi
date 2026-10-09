"use client";

import { Button, Logo } from "@kakushi/ui";
import { ArrowRight, Gavel } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { BlurWords, Rise } from "@/components/motion";
import { closing } from "./content";
import { Shell } from "./section";

/** The closing call to action: the lime card. */
export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="py-20 lg:py-28">
      <Shell>
        <div className="relative isolate overflow-hidden rounded-[32px] px-6 py-16 ring-1 ring-ui-hairline-strong sm:px-12 lg:px-16 lg:py-24">
          <Image src="/art/hero.webp" alt="" fill sizes="(min-width: 1280px) 1216px, 100vw" className="-z-20 object-cover object-[60%_40%]" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#04060f_0%,rgb(4_6_15/0.86)_38%,rgb(4_6_15/0.2)_75%,transparent)]" />
          <BlurWords id="closing-title" as="h2" text={closing.heading} className="serif max-w-[12ch] text-[clamp(40px,6vw,88px)] leading-[1.0]" />
          <Rise y={14} delay={0.3}>
            <p className="mt-5 max-w-[440px] text-[17px] leading-[1.5] text-ui-muted lg:text-[19px]">{closing.sub}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="white" size="lg" iconRight={<ArrowRight />}>
                <Link href="/bridge">Open the bridge</Link>
              </Button>
              <Button asChild variant="outline" size="lg" icon={<Gavel />} className="border-white/40 bg-transparent hover:bg-white/10">
                <Link href="/disputes">Prove a missed payout</Link>
              </Button>
            </div>
          </Rise>
        </div>
      </Shell>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-ui-hairline py-12">
      <Shell className="grid gap-10 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.6fr))]">
        <div className="grid content-start gap-4">
          <Logo height={30} />
          <p className="max-w-[40ch] text-[14px] leading-relaxed text-ui-muted">A trust-minimized instant bridge. Disputes settle on Monad; every payout is attested by Chainlink CRE and missing ones are proven in Noir. Built for Monad Metropolis 2026.</p>
        </div>
        <nav aria-label="Product" className="grid content-start gap-2 text-[15px]">
          <p className="mb-1 text-[13px] font-medium text-ui-muted uppercase">Product</p>
          <Link className="text-ui-muted hover:text-ui-text" href="/bridge">Bridge</Link>
          <Link className="text-ui-muted hover:text-ui-text" href="/activity">Activity</Link>
          <Link className="text-ui-muted hover:text-ui-text" href="/disputes">Disputes</Link>
          <Link className="text-ui-muted hover:text-ui-text" href="/attestations">Attestations</Link>
        </nav>
        <nav aria-label="Makers" className="grid content-start gap-2 text-[15px]">
          <p className="mb-1 text-[13px] font-medium text-ui-muted uppercase">Makers</p>
          <Link className="text-ui-muted hover:text-ui-text" href="/makers">Market</Link>
          <Link className="text-ui-muted hover:text-ui-text" href="/maker">Maker console</Link>
          <a className="text-ui-muted hover:text-ui-text" href="#developers">Developers</a>
          <a className="text-ui-muted hover:text-ui-text" href="https://github.com/nickthelegend/kakushi">GitHub</a>
        </nav>
      </Shell>
      <Shell className="mt-10 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ui-muted">
        <p>© 2026 Kakushi. Testnet: no real money moves.</p>
        <p>Monad · Chainlink CRE · Noir · Privy · Envio · Cleanverse</p>
      </Shell>
    </footer>
  );
}
