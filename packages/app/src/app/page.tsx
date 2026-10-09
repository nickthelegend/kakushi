import type { Metadata } from "next";
import { Chains } from "@/components/landing/chains";
import { Closing, Footer } from "@/components/landing/closing";
import { Developers } from "@/components/landing/developers";
import { Faq } from "@/components/landing/faq";
import { Fees } from "@/components/landing/fees";
import { LandingFrame } from "@/components/landing/frame";
import { Hero } from "@/components/landing/hero";
import { How } from "@/components/landing/how";
import { Makers } from "@/components/landing/makers";
import { LandingNav } from "@/components/landing/nav";
import { Proof } from "@/components/landing/proof";
import { Sponsors } from "@/components/landing/sponsors";
import { Transfer } from "@/components/landing/transfer";
import { SmoothScroll } from "@/components/motion";

export const metadata: Metadata = {
  title: { absolute: "Kakushi: the fast bridge for Monad" },
  description: "Bridge USDC and ETH to and from Monad in about a second, paid from Maker liquidity and backed by Maker margin on Monad.",
};

export default function LandingPage() {
  return (
    <SmoothScroll>
      <LandingFrame className="overflow-hidden">
        <LandingNav />
        <main>
          <Hero />
          <Sponsors />
          <Chains />
          <Transfer />
          <How />
          <Makers />
          <Fees />
          <Proof />
          <Developers />
          <Faq />
          <Closing />
        </main>
        <Footer />
      </LandingFrame>
    </SmoothScroll>
  );
}
