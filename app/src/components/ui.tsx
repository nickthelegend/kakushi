"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Btn({ tone = "primary", busy, children, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "lantern"; busy?: boolean }) {
  const t = tone === "primary" ? "bg-biolum text-abyss hover:brightness-110" : tone === "lantern" ? "bg-lantern text-abyss hover:brightness-110" : "border border-kelp-strong text-foam hover:bg-trench-2";
  return (
    <button {...p} disabled={p.disabled || busy} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${t} ${className}`}>
      {busy ? "Working…" : children}
    </button>
  );
}

export function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-kelp bg-trench/70 p-6 backdrop-blur">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-tide">{sub}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="block text-sm text-tide">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 w-full rounded-xl border border-kelp bg-abyss px-3 py-2.5 text-foam outline-none focus:border-biolum ${mono ? "font-mono text-sm" : "tabular"}`} />
    </label>
  );
}

/** A revealed value: the only lantern-lit thing on the page. */
export function Revealed({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-lantern-soft px-1.5 py-0.5 font-semibold text-lantern tabular">{children}</span>;
}

export function Cipher({ handle }: { handle: string }) {
  return <span className="font-mono text-xs text-biolum/80" title={handle}>{handle.slice(0, 10)}…{handle.slice(-6)}</span>;
}

export function Log({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ol className="space-y-1 rounded-xl bg-abyss p-3 font-mono text-xs text-tide" aria-live="polite">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ol>
  );
}
