"use client";

import { CopyButton, EmptyState, Notice as UiNotice, StatusPill, cn, type NoticeTone, type StatusPillTone } from "@kakushi/ui";
import { ArrowUpRight, Loader2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { chainById } from "@kakushi/config";
import { ChainCoin } from "./coins";

/** Page-level building blocks for the app, in ref E's language (dark panel, lime accent). */

/** Amount with a quieter fraction. */
export function Amount({ value, decimals, symbol, max = 6, className }: { value: bigint; decimals: number; symbol?: string; max?: number; className?: string }) {
  const [i, f = ""] = formatUnits(value, decimals).split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return (
    <span className={cn("ui-figure whitespace-nowrap", className)}>
      {Number(i).toLocaleString("en-US")}
      {frac && <span className="text-ui-muted">.{frac}</span>}
      {symbol && <span className="ml-1 text-ui-muted">{symbol}</span>}
    </span>
  );
}

export function short(a: string, n = 4): string {
  return a.length <= 2 + n * 2 ? a : `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function ago(ts: number | bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** An address you can copy. */
export function Addr({ value, n = 4, className }: { value: string; n?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[13px] text-ui-muted", className)} title={value}>
      {short(value, n)}
      <CopyButton value={value} label="address" />
    </span>
  );
}

/** A transaction hash: an explorer link on testnet, plain on local forks (no explorer). */
export function ChainTx({ chainId, hash, network }: { chainId: number; hash: string; network: "local" | "testnet" }) {
  if (network === "local") {
    return <span className="font-mono text-[13px] text-ui-muted" title={`${hash} (local fork, no explorer)`}>{short(hash, 5)}</span>;
  }
  return (
    <a href={`${chainById(chainId).explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[13px] text-ui-lime-text hover:underline">
      {short(hash, 5)}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

export function ChainName({ chainId, size = 20 }: { chainId: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <ChainCoin chainId={chainId} size={size} />
      {chainById(chainId).shortName}
    </span>
  );
}

export function Route({ src, dst, size = 20 }: { src: number; dst: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <ChainName chainId={src} size={size} />
      <span className="text-ui-muted">→</span>
      <ChainName chainId={dst} size={size} />
    </span>
  );
}

export type Tone = "neutral" | "ok" | "bad" | "warn" | "accent" | "indigo";
const PILL: Record<Tone, StatusPillTone> = { neutral: "neutral", ok: "lime", bad: "red", warn: "amber", accent: "teal", indigo: "purple" };
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <StatusPill tone={PILL[tone]} size="sm" className={cn("whitespace-nowrap", className)}>{children}</StatusPill>;
}

const NOTICE: Record<Tone, NoticeTone> = { neutral: "neutral", ok: "lime", bad: "down", warn: "warn", accent: "info", indigo: "info" };
export function Notice({ tone = "neutral", title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  return <UiNotice tone={NOTICE[tone]} title={title} className={cn("mb-4", className)}>{children}</UiNotice>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-ui-muted", className)} aria-label="loading" />;
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[24px] border border-ui-hairline-strong px-5 py-4 text-[15px] text-ui-muted">
      <Spinner /> {children}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title} description={children} action={action} className="rounded-[24px] border border-dashed border-ui-hairline-strong" />;
}

/** A figure on the canvas tone: label, value, an optional line under it. */
export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-[20px] bg-ui-canvas p-4", className)}>
      <div className="text-[13px] text-ui-muted">{label}</div>
      <div className="ui-figure mt-1 truncate text-[22px] font-medium tracking-[-0.03em]">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-ui-muted">{sub}</div>}
    </div>
  );
}

export function PageHead({ title, sub, right, eyebrow }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="text-[34px] leading-[1.05] font-medium tracking-[-0.04em] sm:text-[44px]">{title}</h1>
        {sub && <p className="mt-3 max-w-[64ch] text-[16px] leading-[1.5] text-pretty text-ui-muted">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

/** Pill-shaped field chrome, matching the swap widget. */
export const fieldCls = "h-12 min-w-0 rounded-full bg-ui-surface-2 px-4 text-[15px] text-ui-text outline-none ring-1 ring-ui-hairline transition placeholder:text-ui-muted focus:ring-ui-lime/50 disabled:opacity-50";

/** A read error, in words: unreachable contracts and services rather than raw RPC text. */
export function readError(e: string | null | undefined): string | null {
  if (!e) return null;
  if (/not configured/i.test(e)) return "This service isn't configured for this deployment yet.";
  if (/reverted|returned no data|fetch failed|ECONNREFUSED|HTTP request failed|Failed to fetch|unreachable/i.test(e)) return "The Kakushi contracts or services for this network aren't reachable right now.";
  return e.split("\n")[0]!;
}

/** A wide strip of the generated art under a page title, faded into the page. */
export function ArtBanner({ src, alt = "", position = "50% 50%", className }: { src: string; alt?: string; position?: string; className?: string }) {
  return (
    <div className={cn("relative mb-8 h-[150px] overflow-hidden rounded-[24px] ring-1 ring-ui-hairline-strong sm:h-[190px]", className)}>
      <Image src={src} alt={alt} fill priority sizes="(min-width: 1480px) 1416px, 100vw" className="object-cover" style={{ objectPosition: position }} />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgb(4_6_15/0.75),transparent_55%)]" />
    </div>
  );
}
