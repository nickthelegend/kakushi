"use client";

import { AppFrame, IconSquareButton, KakushiMark, Logo, Menu, PrimaryButton, SecondaryButton, StatusPill, TopNav } from "@kakushi/ui";
import { ArrowLeftRight, Gavel, Globe, LogOut, ScrollText, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";

export const NAV = [
  { key: "bridge", label: "Bridge", href: "/bridge", icon: <ArrowLeftRight /> },
  { key: "activity", label: "Activity", href: "/activity", icon: <ScrollText /> },
  { key: "disputes", label: "Disputes", href: "/disputes", icon: <Gavel /> },
  { key: "makers", label: "Makers", href: "/makers", icon: <Users /> },
];

export const MORE = [
  { key: "attestations", label: "Attestations", href: "/attestations", icon: <ShieldCheck />, description: "Chainlink CRE windows on Monad" },
  { key: "maker", label: "Maker console", href: "/maker", icon: <Store />, description: "Margin, routes and withdrawals" },
];

function activeKey(pathname: string): string {
  const hit = [...NAV, ...MORE].find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  if (pathname.startsWith("/tx/")) return "activity";
  return hit?.key ?? "bridge";
}

/** Where Kakushi is running, in the network pill's shape. */
export function NetworkPill({ className }: { className?: string }) {
  const { cfg, error } = useRuntime();
  const label = error ? "Testnet deployment pending" : !cfg ? "Monad" : cfg.network === "local" ? "Local forks · Monad hub" : "Monad testnet hub";
  const live = Boolean(cfg && !error);
  return (
    <span className={`inline-flex h-11 items-center gap-2.5 rounded-full bg-ui-surface-1 pr-5 pl-4 text-[15px] font-medium whitespace-nowrap ${className ?? ""}`}>
      <span aria-hidden className="relative grid size-2.5 place-items-center">
        {live ? <span className="absolute size-2.5 animate-ping rounded-full bg-ui-lime-button/60 motion-reduce:animate-none" /> : null}
        <span className={`size-2 rounded-full ${live ? "bg-ui-lime-button" : "bg-ui-muted"}`} />
      </span>
      {label}
    </span>
  );
}

export function ConnectButton({ block = false }: { block?: boolean }) {
  const w = useWallet();
  const { cfg } = useRuntime();
  const [err, setErr] = useState<string | null>(null);
  if (w.address) {
    return (
      <Menu
        label="Wallet"
        align="end"
        width={300}
        triggerClassName={block ? "w-full" : "hidden xl:inline-flex"}
        trigger={
          <span className="inline-flex h-11 w-full items-center gap-2.5 rounded-full bg-ui-surface-1 pr-5 pl-2 text-[15px] font-medium transition-colors hover:bg-ui-surface-2">
            <span className="grid size-7 place-items-center"><KakushiMark title="" width={24} height={24} /></span>
            <span className="ui-figure">{w.address.slice(0, 6)}…{w.address.slice(-4)}</span>
          </span>
        }
      >
        <div className="px-3 py-2 text-[13px] text-ui-muted">{w.label}</div>
        <Menu.Item icon={<LogOut />} tone="danger" onSelect={() => w.disconnect()}>
          Disconnect
        </Menu.Item>
      </Menu>
    );
  }
  return (
    <Menu
      label="Connect a wallet"
      align="end"
      width={320}
      triggerClassName={block ? "w-full" : undefined}
      trigger={
        <span className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ui-lime-button px-5 text-[15px] font-semibold tracking-[-0.005em] text-ui-on-lime hover:brightness-[1.06]">
          <Wallet aria-hidden size={18} strokeWidth={2} />
          Connect
        </span>
      }
    >
      {w.privy.configured ? (
        <Menu.Item icon={<Globe />} description="Email, Google or any wallet. Disputes on Monad need no gas." onSelect={() => w.privy.login?.()}>
          Sign in with Privy
        </Menu.Item>
      ) : (
        <Menu.Item icon={<Globe />} disabled description="Set NEXT_PUBLIC_PRIVY_APP_ID to enable">
          Privy: not configured
        </Menu.Item>
      )}
      <Menu.Item icon={<Wallet />} description="MetaMask, Rabby, any injected wallet" onSelect={() => void w.connectInjected().catch((e) => setErr((e as Error).message))}>
        Browser wallet
      </Menu.Item>
      {cfg?.network === "local"
        ? cfg.localDevKeys.map((d) => (
            <Menu.Item key={d.key} icon={<Users />} description="Local forks only (anvil dev key)" onSelect={() => w.connectLocal(d.key, d.label)}>
              {d.label}
            </Menu.Item>
          ))
        : null}
      {err ? <div className="px-3 py-2 text-[13px] text-ui-down">{err}</div> : null}
    </Menu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/bridge";
  const w = useWallet();
  return (
    <AppFrame>
      <a href="#content" className="sr-only z-[60] rounded-full bg-ui-lime px-4 py-2 font-medium text-ui-on-lime focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <TopNav
        brand={<Logo height={30} />}
        brandHref="/"
        brandLabel="Kakushi, home"
        items={NAV}
        more={{ label: "More", items: MORE }}
        value={activeKey(pathname)}
        linkAs={Link}
        actions={
          <>
            <NetworkPill className="hidden 2xl:inline-flex" />
            <ConnectButton />
            {pathname !== "/bridge" ? (
              <PrimaryButton asChild size="sm" iconRight={<ArrowLeftRight />}>
                <Link href="/bridge">Bridge</Link>
              </PrimaryButton>
            ) : null}
          </>
        }
        compactActions={w.address ? <IconSquareButton label="Bridge" icon={<ArrowLeftRight />} tone="solid" active onClick={() => (location.href = "/bridge")} /> : <ConnectButton />}
        sheetTitle="Kakushi"
        sheetFooter={
          <>
            <NetworkPill className="w-full justify-center" />
            {w.address ? (
              <SecondaryButton size="md" block icon={<LogOut />} onClick={() => w.disconnect()} className="bg-ui-surface-2 hover:bg-ui-surface-3">
                Disconnect
              </SecondaryButton>
            ) : null}
          </>
        }
      />
      <main id="content" tabIndex={-1} className="px-4 pt-2 pb-16 outline-none sm:px-6 lg:px-10 lg:pt-0 xl:px-14 xl:pb-14">
        <div className="mx-auto w-full max-w-[1480px]">{children}</div>
      </main>
    </AppFrame>
  );
}

export { StatusPill };
