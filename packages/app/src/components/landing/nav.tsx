"use client";

import { Button, Logo, PrimaryButton, TopNav } from "@kakushi/ui";
import { CircleHelp, CodeXml, FileCheck2, Network, Route, Scale, Tag, Users } from "lucide-react";
import Link from "next/link";
import { NetworkPill } from "@/components/AppShell";
import { nav } from "./content";

const ICONS: Record<string, React.ReactNode> = {
  "#chains": <Network />,
  "#compare": <Scale />,
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
    <PrimaryButton asChild size="sm" iconRight={<CodeXml />}>
      <Link href="/developers">Add privacy</Link>
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
            <Link href="/send">Open app</Link>
          </Button>
          {cta}
        </>
      }
      compactActions={cta}
      sheetFooter={
        <PrimaryButton asChild size="lg" block iconRight={<CodeXml />}>
          <Link href="/developers">Add privacy</Link>
        </PrimaryButton>
      }
    />
  );
}
