"use client";

import { Button, Logo, PrimaryButton, TopNav } from "@kakushi/ui";
import { ArrowLeftRight, CircleHelp, CodeXml, FileCheck2, Route, Tag, Users } from "lucide-react";
import Link from "next/link";
import { NetworkPill } from "@/components/AppShell";
import { nav } from "./content";

const ICONS: Record<string, React.ReactNode> = {
  "#how": <Route />,
  "#proof": <FileCheck2 />,
  "#developers": <CodeXml />,
  "#makers": <Users />,
  "#fees": <Tag />,
  "#faq": <CircleHelp />,
};

/** The landing's top bar (ref E's TopNav): wordmark, section links, network, and the lime CTA. */
export function LandingNav() {
  const cta = (
    <PrimaryButton asChild size="sm" iconRight={<ArrowLeftRight />}>
      <Link href="/bridge">Open the bridge</Link>
    </PrimaryButton>
  );
  return (
    <TopNav
      brand={<Logo height={30} />}
      brandHref="/"
      brandLabel="Kakushi, home"
      items={nav.links.map((l) => ({ key: l.href, label: l.label, href: l.href, icon: ICONS[l.href] }))}
      linkAs="a"
      contained
      sheetTitle="Kakushi"
      actions={
        <>
          <NetworkPill className="hidden xl:inline-flex" />
          <Button asChild variant="outline" size="sm" className="hidden border-white/70 bg-transparent hover:bg-white/10 lg:inline-flex">
            <Link href="/disputes">Prove a payout</Link>
          </Button>
          {cta}
        </>
      }
      compactActions={cta}
      sheetFooter={
        <PrimaryButton asChild size="lg" block iconRight={<ArrowLeftRight />}>
          <Link href="/bridge">Open the bridge</Link>
        </PrimaryButton>
      }
    />
  );
}
