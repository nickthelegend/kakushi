"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useRt } from "@/lib/runtime";

const NAV = [
  { href: "/playground", label: "Playground" },
  { href: "/developers", label: "Developers" },
  { href: "/metrics", label: "Live metrics" },
];

function Account() {
  const rt = useRt();
  const [open, setOpen] = useState(false);
  if (rt.account)
    return (
      <button onClick={rt.disconnect} title="Disconnect" className="rounded-full border border-kelp-strong px-3.5 py-1.5 text-sm text-tide hover:text-foam">
        {rt.label}: <span className="font-mono">{rt.account.slice(0, 6)}…{rt.account.slice(-4)}</span>
      </button>
    );
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-full bg-biolum px-4 py-1.5 text-sm font-semibold text-abyss hover:brightness-110">
        Connect
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-kelp-strong bg-trench p-2 shadow-2xl">
          <button onClick={() => rt.connectInjected().then(() => setOpen(false)).catch(() => {})} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-trench-2">
            Browser wallet
          </button>
          {rt.cfg?.localKeys.map((k) => (
            <button key={k.key} onClick={() => { rt.connectLocal(k.key, k.label.split(" ")[0]!); setOpen(false); }} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-trench-2">
              {k.label} <span className="text-silt">local fork</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { cfg } = useRt();
  return (
    <div className="relative z-[1] min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2" aria-label="Fhish home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fhish-fin.png" alt="" className="size-8" />
          <span className="font-display text-lg font-bold tracking-tight">fhish</span>
        </Link>
        <nav className="hidden gap-5 text-sm md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? "text-biolum" : "text-tide hover:text-foam"}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {cfg && <span className="hidden text-xs text-silt sm:inline">{cfg.network === "local" ? "Monad testnet fork" : "Monad testnet"}</span>}
          <Account />
        </div>
      </header>
      <main>{children}</main>
      <footer className="mx-auto mt-24 max-w-6xl border-t border-kelp px-5 py-8 text-sm text-silt">
        Fhish on Monad. FHE by Zama tfhe-rs; the coprocessor, KMS and contracts are Fhish. <a className="text-tide hover:text-foam" href="https://github.com/fhish-tech">github.com/fhish-tech</a>
      </footer>
    </div>
  );
}
