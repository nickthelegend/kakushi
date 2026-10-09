import type { Metadata } from "next";
import { Chains } from "@/components/landing/chains";
import { Compare } from "@/components/landing/compare";
import { Closing, Footer } from "@/components/landing/closing";
import { Developers } from "@/components/landing/developers";
import { Faq } from "@/components/landing/faq";
import { Fees } from "@/components/landing/fees";
import { LandingFrame } from "@/components/landing/frame";
import { Hero } from "@/components/landing/hero";
import { How } from "@/components/landing/how";
import { Makers } from "@/components/landing/makers";
import { LandingNav } from "@/components/landing/nav";
import { Sponsors } from "@/components/landing/sponsors";
import { SmoothScroll } from "@/components/motion";

export const metadata: Metadata = {
  title: { absolute: "Kakushi: privacy for any app" },
  description: "Stealth addresses, a zero-knowledge pool and a private bridge for any app, on Monad and every chain it talks to.",
};

export default function LandingPage() {
  return (
    <SmoothScroll>
      <LandingFrame className="overflow-hidden">
        <LandingNav />
        <main>
          <Hero />
          <Sponsors />
          <How />
          <Chains />
          <Compare />
          <Developers />
          <Makers />
          <Fees />
          <Faq />
          <Closing />
        </main>
        <Footer />
      </LandingFrame>
    </SmoothScroll>
  );
}
