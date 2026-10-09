"use client";

import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { formatUnits } from "viem";
import { chainById } from "@kakushi/config";

export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "ghost" | "soft" | "danger" | "indigo";
export function Button({ variant = "primary", loading, className, children, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-accent text-white hover:brightness-110 shadow-[0_8px_30px_-12px_rgba(255,77,46,0.6)]",
    ghost: "bg-transparent text-text border border-line-strong hover:bg-s2",
    soft: "bg-s2 text-text hover:bg-s3",
    danger: "bg-bad-soft text-bad hover:bg-bad/20",
    indigo: "bg-indigo-soft text-indigo hover:bg-indigo/25",
  };
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        styles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...p}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-w-0 rounded-[28px] border border-line bg-s1 p-6", className)} {...p}>
      {children}
    </div>
  );
}

type Tone = "neutral" | "ok" | "bad" | "warn" | "accent" | "indigo";
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t: Record<Tone, string> = {
    neutral: "bg-s2 text-muted",
    ok: "bg-ok-soft text-ok",
    bad: "bg-bad-soft text-bad",
    warn: "bg-warn-soft text-warn",
    accent: "bg-accent-soft text-accent",
    indigo: "bg-indigo-soft text-indigo",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", t[tone], className)}>{children}</span>;
}

/** Amount with dim decimals (the integer part bright, the fraction at ~45%). */
export function Amount({ value, decimals, symbol, max = 6, className }: { value: bigint; decimals: number; symbol?: string; max?: number; className?: string }) {
  const s = formatUnits(value, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return (
    <span className={cn("tabular", className)}>
      {Number(i).toLocaleString("en-US")}
      {frac && <span className="opacity-45">.{frac}</span>}
      {symbol && <span className="ml-1 opacity-45">{symbol}</span>}
    </span>
  );
}

export function short(a: string, n = 4): string {
  return a.length <= 2 + n * 2 ? a : `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function Addr({ value, n = 4, className }: { value: string; n?: number; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={cn("inline-flex items-center gap-1 font-mono text-[13px] text-muted hover:text-text", className)}
    >
      {short(value, n)}
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 opacity-60" />}
    </button>
  );
}

export function TxLink({ chainId, hash, network }: { chainId: number; hash: string; network: "local" | "testnet" }) {
  if (network === "local") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-muted" title={`${hash} (local fork, no explorer)`}>
        {short(hash, 5)}
      </span>
    );
  }
  return (
    <a href={`${chainById(chainId).explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-indigo hover:underline">
      {short(hash, 5)}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

const CHAIN_COLOR: Record<number, string> = { 10143: "#836EF9", 11155111: "#8A92B2", 84532: "#2F6BFF" };
export function ChainDot({ chainId, size = 10 }: { chainId: number; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: CHAIN_COLOR[chainId] ?? "#888" }} />;
}

export function ChainName({ chainId }: { chainId: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ChainDot chainId={chainId} />
      {chainById(chainId).shortName}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[20px] bg-s2 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-dim">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dashed border-line-strong p-8 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = {
    neutral: "border-line bg-s2 text-muted",
    ok: "border-ok/20 bg-ok-soft text-ok",
    bad: "border-bad/20 bg-bad-soft text-bad",
    warn: "border-warn/25 bg-warn-soft text-warn",
    accent: "border-accent/25 bg-accent-soft text-accent",
    indigo: "border-indigo/25 bg-indigo-soft text-indigo",
  };
  return <div className={cn("rounded-2xl border px-4 py-3 text-sm", t[tone])}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} aria-label="loading" />;
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl break-words text-[15px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function ago(ts: number | bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
