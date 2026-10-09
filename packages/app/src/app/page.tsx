import type { Metadata } from "next";
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
  title: { absolute: "Kakushi: bridge in a second, backed by proof" },
  description: "Pay a Maker directly and it pays you on the other chain in about a second. If it doesn't, a zero-knowledge proof takes its margin on Monad and gives it to you.",
};

export default function LandingPage() {
  return (
    <SmoothScroll>
      <LandingFrame className="overflow-hidden">
        <LandingNav />
        <main>
          <Hero />
          <Sponsors />
          <Transfer />
          <How />
          <Proof />
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
