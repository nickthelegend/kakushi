"use client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useRt } from "@/lib/runtime";
import { usePay } from "@/lib/pay/wallet";
import { explain, type PayEnv } from "@/lib/pay/flows";
import { short } from "@/lib/pay/core";

/** Everything a Fhish Pay page needs from the runtime, or null while loading / not deployed. */
export function usePayEnv(): PayEnv | null {
  const rt = useRt();
  return useMemo(() => {
    const a = rt.cfg?.apps;
    const d = rt.cfg?.deployment;
    if (!rt.client || !rt.fhish || !a?.causd || !a.ausd || !d) return null;
    return {
      client: rt.client,
      fhish: rt.fhish,
      token: a.causd,
      ausd: a.ausd,
      oracle: d.oracle,
      chainId: rt.cfg!.chainId,
      network: rt.cfg!.network,
      fromBlock: BigInt((d as { deployBlock?: number }).deployBlock ?? 0),
    } satisfies PayEnv;
  }, [rt.client, rt.fhish, rt.cfg]);
}

/** busy/progress/error state for one action, with a readable error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: (step: (s: string) => void) => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStep(null);
    try {
      await fn(setStep);
      setStep(null);
    } catch (e) {
      setError(explain(e));
      setStep(null);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, step, error, run, setError };
}

export function Status({ step, error }: { step: string | null; error: string | null }) {
  if (!step && !error) return null;
  return (
    <p role={error ? "alert" : "status"} aria-live="polite" className={`text-sm ${error ? "text-reef" : "text-tide"}`}>
      {error ?? step}
    </p>
  );
}

export function PrivyBanner() {
  const pay = usePay();
  const { cfg } = useRt();
  if (pay.mode === "privy") return null;
  return (
    <div className="rounded-2xl border border-lantern/30 bg-lantern-soft px-4 py-3 text-sm" role="note">
      <p className="font-semibold text-lantern">Privy not configured</p>
      <p className="mt-1 text-tide">
        Running on the {cfg?.network === "local" ? "local Monad testnet fork" : "network"} with LOCAL ANVIL ONLY dev accounts, so every flow still works end to end. With a Privy app ID this page signs you in by email or passkey, gives you an embedded wallet, and sponsors your gas. Setup: <code className="font-mono text-foam">app/PRIVY.md</code>.
      </p>
    </div>
  );
}

/** Shown in place of a page's actions until someone is signed in. */
export function SignIn({ why, guestFirst = false }: { why: string; guestFirst?: boolean }) {
  const pay = usePay();
  if (pay.mode === "privy")
    return (
      <div className="rounded-[22px] border border-kelp-strong bg-trench/80 p-6">
        <p className="text-tide">{why}</p>
        <button onClick={pay.login} disabled={!pay.ready} className="mt-4 rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
          {pay.ready ? "Sign in with email or passkey" : "Loading Privy…"}
        </button>
        <p className="mt-3 text-xs text-silt">Privy creates a wallet for you on Monad. No seed phrase, no gas to buy.</p>
      </div>
    );
  const guest = (
    <button key="guest" onClick={pay.local.guest} className="rounded-xl border border-kelp-strong px-4 py-2.5 text-left text-sm hover:bg-trench-2">
      <span className="font-semibold">New guest account</span>
      <span className="block text-xs text-silt">fresh key in this browser · fork only</span>
    </button>
  );
  return (
    <div className="rounded-[22px] border border-kelp-strong bg-trench/80 p-6">
      <p className="text-tide">{why}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {guestFirst && guest}
        {pay.local.accounts.map((k) => (
          <button key={k.key} onClick={() => pay.local.select(k.key, k.label.split(" ")[0]!)} className="rounded-xl border border-kelp-strong px-4 py-2.5 text-left text-sm hover:bg-trench-2">
            <span className="font-semibold">{k.label.split(" ")[0]}</span>
            <span className="block text-xs text-silt">{k.label.split(" ").slice(1).join(" ")} · dev account</span>
          </button>
        ))}
        {!guestFirst && guest}
      </div>
      {!pay.local.accounts.length && <p className="mt-3 text-sm text-reef">No local accounts: the app is not running against the fork.</p>}
    </div>
  );
}

/** Header chip on Fhish Pay pages: who is signed in, and sign out. */
export function PayChip() {
  const pay = usePay();
  if (!pay.wallet)
    return pay.mode === "privy" ? (
      <button onClick={pay.login} disabled={!pay.ready} className="rounded-full bg-biolum px-4 py-1.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
        Sign in
      </button>
    ) : (
      <span className="rounded-full border border-kelp-strong px-3 py-1.5 text-xs text-silt">Not signed in</span>
    );
  return (
    <button onClick={pay.logout} title="Sign out" className="max-w-[60vw] truncate rounded-full border border-kelp-strong px-3.5 py-1.5 text-sm text-tide hover:text-foam">
      {pay.wallet.label}: <span className="font-mono">{short(pay.wallet.address)}</span>
    </button>
  );
}

export function Card({ title, sub, children, aside }: { title: string; sub?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-kelp bg-trench/70 p-5 backdrop-blur sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-display text-lg font-bold sm:text-xl">{title}</h2>
          {sub && <p className="mt-1 max-w-prose text-sm text-tide">{sub}</p>}
        </div>
        {aside && <div className="ml-auto shrink-0">{aside}</div>}
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function Input({ label, value, onChange, mono, placeholder, inputMode, id, suffix }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; inputMode?: "decimal" | "text" | "numeric"; id?: string; suffix?: string }) {
  return (
    <label className="block text-sm text-tide" htmlFor={id}>
      {label}
      <span className="relative mt-1 block">
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border border-kelp bg-abyss px-3 py-2.5 text-foam outline-none placeholder:text-silt/70 focus:border-biolum ${mono ? "font-mono text-sm" : "tabular"} ${suffix ? "pr-16" : ""}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-silt">{suffix}</span>}
      </span>
    </label>
  );
}

export const amountOk = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.replace(/,/g, "").trim()) && Number(v.replace(/,/g, "")) > 0;
export const addrOk = (v: string): v is Hex => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
