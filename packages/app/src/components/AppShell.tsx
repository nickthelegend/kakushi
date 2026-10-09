"use client";

import { AppFrame, IconSquareButton, KakushiMark, Logo, Menu, SecondaryButton, StatusPill, TopNav } from "@kakushi/ui";
import { ArrowLeftRight, BookOpen, Compass, Gavel, GitBranch, Globe, LogOut, ShieldCheck, Star, Store, Trophy, UserPlus, Users, Wallet, BarChart3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useRuntime } from "@/lib/runtime";
import { useIndexer, type PointsView } from "@/lib/engage";
import { useStoredReferrer } from "@/lib/referral";
import { useWallet } from "@/lib/wallet";

export const NAV = [
  { key: "trade", label: "Trade", href: "/bridge", icon: <ArrowLeftRight /> },
  { key: "explorer", label: "Explorer", href: "/explorer", icon: <Compass /> },
  { key: "quests", label: "Quests", href: "/quests", icon: <Trophy /> },
  { key: "market", label: "Market", href: "/market", icon: <BarChart3 /> },
];

export const MORE = [
  { key: "claim", label: "Claim", href: "/disputes", icon: <Gavel />, description: "A Maker didn't pay? Prove it, get paid from margin" },
  { key: "referral", label: "Referral", href: "/referral", icon: <UserPlus />, description: "Invite friends, earn 10% of their points" },
  { key: "maker", label: "Become a Maker", href: "/maker", icon: <Store />, description: "Post margin, set fees, earn on every fill" },
  { key: "attestations", label: "Attestations", href: "/attestations", icon: <ShieldCheck />, description: "Chainlink CRE windows on Monad" },
  { key: "docs", label: "Docs", href: "https://github.com/nickthelegend/kakushi#readme", icon: <BookOpen />, description: "How Kakushi works" },
  { key: "github", label: "GitHub", href: "https://github.com/nickthelegend/kakushi", icon: <GitBranch />, description: "Open source, MIT" },
];

function activeKey(pathname: string): string {
  const hit = [...NAV, ...MORE].find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  if (pathname.startsWith("/tx/") || pathname.startsWith("/explorer")) return "explorer";
  if (pathname.startsWith("/market")) return "market";
  return hit?.key ?? "trade";
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

/** The connected wallet's points, Orbiter's O-Points in Kakushi's shape. */
export function PointsPill() {
  const w = useWallet();
  const { data, configured } = useIndexer<PointsView>(w.address ? `points?address=${w.address.toLowerCase()}` : null, 15000);
  if (!w.address || !configured) return null;
  return (
    <Link href="/quests" className="hidden h-11 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#1a2a8a,#121831)] pr-4 pl-3 text-[14px] font-medium ring-1 ring-[#3b55ff]/40 transition hover:brightness-110 lg:inline-flex">
      <Star aria-hidden size={15} className="fill-[#f2c27a] text-[#f2c27a]" />
      <span className="ui-figure">{data ? data.points.toLocaleString("en-US") : "—"}</span>
      <span className="text-ui-muted">pts</span>
    </Link>
  );
}

/** The app's sky: navy, a blue bloom, a faint star field and the coins, blurred, low on the page. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#04060f]">
      <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_-5%,rgb(47_71_245/0.30),transparent_70%)]" />
      <div className="app-stars absolute inset-0 opacity-70" />
      <div className="absolute inset-x-[-10%] bottom-[-18%] h-[55%] bg-[url('/art/coins.webp')] bg-cover bg-center opacity-[0.22] blur-[42px] saturate-150" />
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-[radial-gradient(60%_80%_at_50%_100%,rgb(47_71_245/0.22),transparent_70%)]" />
    </div>
  );
}

export function ConnectButton({ block = false, large = false }: { block?: boolean; large?: boolean }) {
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
      className={block ? "flex w-full" : undefined}
      triggerClassName={block ? "w-full" : undefined}
      trigger={
        <span className={`inline-flex w-full items-center justify-center gap-2 rounded-full bg-ui-lime-button px-5 font-semibold tracking-[-0.005em] text-ui-on-lime hover:brightness-[1.06] ${large ? "h-[58px] text-[17px] shadow-[0_14px_40px_-12px_rgb(47_71_245/0.8)]" : "h-11 text-[15px]"}`}>
          <Wallet aria-hidden size={18} strokeWidth={2} />
          {large ? "Connect wallet" : "Connect"}
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
  useStoredReferrer(); // remember a ?ref= link from any page
  return (
    <AppFrame className="isolate bg-transparent" panelClassName="bg-transparent">
      <Backdrop />
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
            <PointsPill />
            <ConnectButton />
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
