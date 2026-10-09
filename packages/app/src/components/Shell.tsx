"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, Wallet, X } from "lucide-react";
import { Logo } from "./Logo";
import { Button, Pill, cn, short } from "./ui";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { MaybePrivy } from "@/lib/privy";

const NAV = [
  { href: "/bridge", label: "Bridge" },
  { href: "/activity", label: "Activity" },
  { href: "/disputes", label: "Disputes" },
  { href: "/makers", label: "Makers" },
  { href: "/attestations", label: "Attestations" },
];

function NetworkPill() {
  const { cfg, error } = useRuntime();
  if (error) return <Pill tone="bad">not deployed</Pill>;
  if (!cfg) return <Pill>…</Pill>;
  return cfg.network === "local" ? (
    <Pill tone="warn">
      <span className="size-1.5 rounded-full bg-warn" /> Local forks
    </Pill>
  ) : (
    <Pill tone="indigo">
      <span className="size-1.5 rounded-full bg-indigo" /> Testnet
    </Pill>
  );
}

export function WalletMenu() {
  const w = useWallet();
  const { cfg } = useRuntime();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      {w.address ? (
        <button onClick={() => setOpen((o) => !o)} className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-s1 pl-3 pr-2 text-sm hover:bg-s2" aria-haspopup="menu" aria-expanded={open}>
          <span className="size-2 rounded-full bg-ok" />
          <span className="font-mono whitespace-nowrap">{short(w.address, 4)}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      ) : (
        <Button className="h-10 px-4 text-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          <Wallet className="size-4" /> Connect
        </Button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-6rem))] rounded-2xl border border-line-strong bg-s1 p-2 shadow-2xl">
          {w.address ? (
            <>
              <div className="px-3 py-2 text-xs text-muted">{w.label}</div>
              <div className="px-3 pb-2 font-mono text-sm break-all">{w.address}</div>
              <button role="menuitem" onClick={() => { w.disconnect(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-bad hover:bg-s2">
                <LogOut className="size-4" /> Disconnect
              </button>
            </>
          ) : (
            <>
              {cfg?.network !== "local" && w.privy.configured ? (
                <button role="menuitem" onClick={() => { w.privy.login?.(); setOpen(false); }} className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-s2">
                  <div className="font-medium">Sign in with Privy</div>
                  <div className="text-xs text-muted">Email, Google or any wallet · gasless disputes on Monad</div>
                </button>
              ) : (
                <div className="rounded-xl px-3 py-2.5 text-left text-sm text-dim">
                  <div className="font-medium">Privy: not configured</div>
                  <div className="text-xs">{cfg?.network === "local" ? "Use a local fork account below." : "Sign-in and gas sponsorship are unavailable."}</div>
                </div>
              )}
              {cfg?.network !== "local" && <button role="menuitem" onClick={async () => { try { await w.connectInjected(); setOpen(false); } catch (e) { setErr((e as Error).message); } }} className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-s2">
                <div className="font-medium">Browser wallet</div>
                <div className="text-xs text-muted">MetaMask, Rabby, …</div>
              </button>}
              {cfg?.network === "local" && cfg.localDevKeys.length > 0 && (
                <div className="mt-1 border-t border-line pt-1">
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-dim">Local fork accounts (anvil dev keys)</div>
                  {cfg.localDevKeys.map((d) => (
                    <button role="menuitem" key={d.key} onClick={() => { w.connectLocal(d.key, d.label); setOpen(false); }} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-s2">
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
              {err && <div className="px-3 py-2 text-xs text-bad">{err}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { cfg, error } = useRuntime();
  const [mobile, setMobile] = useState(false);
  return (
    <MaybePrivy appId={cfg?.privyAppId ?? null}>
      <div className="glow min-h-dvh">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
            <Link href="/" aria-label="Kakushi home">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={cn("rounded-full px-3 py-1.5 text-sm transition", path?.startsWith(n.href) ? "bg-s2 text-text" : "text-muted hover:text-text")}>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:block"><NetworkPill /></div>
              <WalletMenu />
              <button className="rounded-full p-2 text-muted md:hidden" onClick={() => setMobile((m) => !m)} aria-label="Menu">
                {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
          {(cfg || error) && <div className={cn("flex items-center justify-between gap-2 border-t border-line px-4 py-1.5 text-xs sm:hidden", cfg?.network === "local" ? "text-warn" : "text-indigo")}>
            <span>{cfg?.network === "local" ? "Local fork demo" : "Testnet"}</span>
            {error && <NetworkPill />}
          </div>}
          {mobile && (
            <nav className="border-t border-line px-4 py-2 md:hidden">
              {[...NAV, { href: "/maker", label: "Maker console" }].map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setMobile(false)} className="block rounded-xl px-3 py-2.5 text-[15px] text-muted hover:bg-s2 hover:text-text">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
        <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pb-10 text-xs text-dim sm:flex-row sm:justify-between sm:px-6">
          <span>Kakushi · trust-minimized instant bridge · hub on Monad · attestations by Chainlink CRE · proofs in Noir</span>
          <span className="flex gap-4">
            <Link href="/maker" className="hover:text-text">Maker console</Link>
            <a href="https://github.com/nickthelegend/kakushi" className="hover:text-text">GitHub</a>
          </span>
        </footer>
      </div>
    </MaybePrivy>
  );
}
