"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lock } from "lucide-react";

// Data comes from the Kakushi Pay indexer (Envio HyperIndex) through /api/indexer.
// Payment amounts are FHE ciphertext handles: this page can only ever show the handle.

type Kind = "PAY" | "PAYROLL" | "LINK_CLAIM" | "TRANSFER";
type Num = number | string;
interface Snapshot {
  chain_metadata: { chain_id: number; block_height: number; latest_processed_block: number; num_events_processed: number; is_hyper_sync: boolean }[];
  GlobalStats: Record<string, Num | null>[];
  Token: { id: string; symbol: string; underlyingSymbol: string; decimals: number; publicTvl: string; publicWrapped: string; publicUnwrapped: string; payments: number }[];
  Payment: { id: string; kind: Kind; amountHandle: string; ref: string | null; blockNumber: number; timestamp: number; txHash: string; from_id: string; to_id: string; token: { symbol: string }; payrollRun: { count: number; viaOperator: boolean } | null }[];
  PayLink: { id: string; linkId: string; state: "OPEN" | "CLAIMED" | "REFUNDED"; sender_id: string; claimedBy_id: string | null; createdAt: number; claimSeconds: number | null; amountHandle: string }[];
  PayRequest?: { id: string; requestId: string; payee_id: string; payer_id: string; ref: string; expiry: number; createdAt: number; payAttempts: number; lastPaidAt: number | null; cancelled: boolean; dueHandle: string }[];
  Reveal: { id: string; requestId: string; app: string; handlesCount: number; status: "PENDING" | "FULFILLED"; path: "RELAYER" | "CRE" | null; latencySeconds: number | null; latencyBlocks: number | null; callbackOk: boolean | null; requestedAt: number }[];
  FheOpStat: { name: string; count: number; scalarCount: number }[];
}

const n = (v: Num | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const secs = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v < 90 ? `${fmt(v, 1)} s` : v < 5400 ? `${fmt(v / 60, 1)} min` : `${fmt(v / 3600, 1)} h`);
function units(raw: string, decimals: number) {
  const b = BigInt(raw || "0");
  const base = BigInt(10) ** BigInt(decimals);
  return Number(b / base) + Number(b % base) / Number(base);
}
/** `nowSec` is chain time: a local fork can run ahead of the wall clock (evm_increaseTime). */
function ago(ts: number, nowSec: number) {
  const d = Math.max(0, Math.floor(nowSec - ts));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
/** bytes32 reference -> readable text when it is ASCII, else a short hex. */
function refText(ref: string | null) {
  if (!ref) return null;
  const hex = ref.replace(/^0x/, "").replace(/(00)+$/, "");
  if (!hex) return null;
  const s = hex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  return s.every((c) => c >= 32 && c < 127) ? String.fromCharCode(...s) : short(ref);
}

const KIND: Record<Kind, { label: string; cls: string }> = {
  PAY: { label: "Payment", cls: "border-biolum/40 text-biolum" },
  PAYROLL: { label: "Salary", cls: "border-sea-green/40 text-sea-green" },
  LINK_CLAIM: { label: "Link claimed", cls: "border-foam/30 text-foam" },
  TRANSFER: { label: "Transfer", cls: "border-kelp-strong text-tide" },
};

/** The amount, as it exists on chain: a ciphertext handle. */
function Sealed({ handle }: { handle: string }) {
  return (
    <span
      title={`Encrypted amount (euint64 handle)\n${handle}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-biolum/20 bg-biolum-soft px-2 py-0.5 font-mono text-xs text-biolum"
    >
      <Lock aria-hidden className="size-3" strokeWidth={2.5} />
      <span className="sr-only">Encrypted amount, handle </span>
      {handle.slice(0, 6)}…{handle.slice(-4)}
    </span>
  );
}

function Stat({ label, value, sub, foot }: { label: string; value: string; sub?: string; foot?: string }) {
  return (
    <div className="rounded-[20px] border border-kelp bg-trench/70 p-5 backdrop-blur">
      <div className="text-sm text-silt">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-bold tabular text-foam">{value}</div>
      {sub && <div className="mt-1.5 text-sm text-tide">{sub}</div>}
      {foot && <div className="mt-1 text-xs text-silt">{foot}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-[132px] animate-pulse rounded-[20px] border border-kelp bg-trench/50" />
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const anchor = useRef({ chainTs: 0, wall: 0 });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/indexer", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.data) throw new Error(j.error ?? JSON.stringify(j.errors ?? j));
        const data = j.data as Snapshot;
        const ids = data.Payment.map((p) => p.id);
        if (seen.current) {
          const nu = ids.filter((id) => !seen.current!.has(id));
          if (nu.length) {
            setFresh(new Set(nu));
            setTimeout(() => alive && setFresh(new Set()), 2600);
          }
        }
        seen.current = new Set(ids);
        setS(data);
        setErr(null);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
      if (alive) setNow(Date.now());
    };
    void load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const g = s?.GlobalStats[0] ?? {};
  const meta = s?.chain_metadata[0];
  const tok = s?.Token[0];
  const tvl = s ? s.Token.reduce((a, t) => a + units(t.publicTvl, t.decimals), 0) : 0;
  const maxOp = Math.max(1, ...(s?.FheOpStat.map((o) => o.count) ?? [1]));
  // chain time = newest event time, advanced by wall time since we first saw it (events show up within ~3 s)
  const newest = Math.max(0, ...(s?.Payment.map((p) => p.timestamp) ?? []), ...(s?.Reveal.map((r) => r.requestedAt) ?? []));
  if (newest > anchor.current.chainTs) anchor.current = { chainTs: newest, wall: now };
  const chainNow = Math.max(now / 1000, anchor.current.chainTs + (now - anchor.current.wall) / 1000);

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Live activity</h1>
          <p className="mt-3 max-w-2xl text-tide">
            Every Kakushi Pay payment on Monad, indexed as it lands. Who paid whom and when is public. How much never is: each amount below is the ciphertext handle the chain stores.
          </p>
        </div>
        {meta && (
          <div className="flex items-center gap-2 rounded-full border border-kelp-strong px-3.5 py-1.5 text-xs text-tide" role="status">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sea-green opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-sea-green" />
            </span>
            block <span className="tabular text-foam">{fmt(meta.latest_processed_block)}</span>
            {meta.latest_processed_block < meta.block_height && <span className="text-silt">/ {fmt(meta.block_height)}</span>}
            <span className="text-silt">·</span>
            <span className="tabular">{fmt(meta.num_events_processed)}</span> events
            <span className="text-silt">·</span>
            {meta.is_hyper_sync ? "HyperSync" : "RPC"}
          </div>
        )}
      </div>

      {err && (
        <p role="alert" className="mt-8 rounded-xl border border-reef/40 bg-reef/10 p-4 text-sm text-reef">
          {err}
        </p>
      )}
      {!s && !err && <Skeleton />}

      {s && (
        <>
          <section aria-label="Totals" className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat
              label="Private payments"
              value={fmt(n(g.payments))}
              sub={`${fmt(n(g.pays))} pay · ${fmt(n(g.payrollPayments))} salaries · ${fmt(n(g.linkClaims))} links · ${fmt(n(g.transfers))} transfers`}
              foot={`${fmt(n(g.uniquePayers))} unique payers · ${fmt(n(g.accounts))} accounts`}
            />
            <Stat
              label="Payroll runs"
              value={fmt(n(g.payrollRuns))}
              sub={`${fmt(n(g.payrollPayments))} encrypted salaries paid`}
              foot={`${fmt(n(g.payrollRunsViaOperator))} run by an operator wallet`}
            />
            <Stat
              label="Pay links claimed"
              value={`${fmt(n(g.linksClaimed))} / ${fmt(n(g.linksCreated))}`}
              sub={`median claim ${secs(g.linkClaimMedianSeconds === null ? null : n(g.linkClaimMedianSeconds))} · avg ${secs(g.linkClaimAvgSeconds === null ? null : n(g.linkClaimAvgSeconds))}`}
              foot={`${fmt(n(g.linksOpen))} open · ${fmt(n(g.linksRefunded))} refunded`}
            />
            <Stat
              label="KMS reveals"
              value={fmt(n(g.revealsFulfilled))}
              sub={`avg ${secs(g.revealAvgLatencySeconds === null ? null : n(g.revealAvgLatencySeconds))} · ${fmt(n(g.revealAvgLatencyBlocks), 1)} blocks to callback`}
              foot={`${fmt(n(g.revealsViaRelayer))} relayer · ${fmt(n(g.revealsViaCre))} Chainlink CRE · ${fmt(n(g.revealsPending))} pending`}
            />
            <Stat
              label="Public TVL"
              value={fmt(tvl, 2)}
              sub={tok ? `${tok.underlyingSymbol} held by ${s.Token.map((t) => t.symbol).join(", ")}` : "nothing wrapped yet"}
              foot={tok ? `wrapped ${fmt(units(tok.publicWrapped, tok.decimals), 2)} · cashed out ${fmt(units(tok.publicUnwrapped, tok.decimals), 2)}` : undefined}
            />
            <Stat
              label="FHE operations"
              value={fmt(n(g.fheOps))}
              sub={`${fmt(n(g.fheInputsVerified))} encrypted inputs verified`}
              foot={`${fmt(n(g.fheSelects))} selects · ${fmt(n(g.fheTrivialEncrypts))} constants`}
            />
          </section>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            <section aria-labelledby="feed" className="lg:col-span-2">
              <div className="flex items-baseline justify-between">
                <h2 id="feed" className="font-display text-2xl font-bold">
                  Payment feed
                </h2>
                <span className="text-xs text-silt">refreshes every 3 s</span>
              </div>
              {s.Payment.length === 0 ? (
                <p className="mt-6 rounded-xl border border-kelp p-6 text-tide">No payments yet. Send one from the Pay page and it appears here within a few seconds.</p>
              ) : (
                <ol className="mt-5 divide-y divide-kelp rounded-[20px] border border-kelp bg-trench/50">
                  {s.Payment.map((p) => {
                    const k = KIND[p.kind];
                    const r = refText(p.ref);
                    return (
                      <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-[2000ms] ${fresh.has(p.id) ? "bg-biolum-soft" : ""}`}>
                        <span className={`w-[104px] shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-semibold ${k.cls}`}>{k.label}</span>
                        <span className="flex min-w-0 items-center gap-1.5 font-mono text-sm text-foam">
                          {short(p.from_id)}
                          <ArrowRight aria-label="to" className="size-3.5 text-silt" />
                          {short(p.to_id)}
                        </span>
                        <Sealed handle={p.amountHandle} />
                        <span className="text-xs text-silt">{p.token.symbol}</span>
                        <span className="ml-auto flex items-center gap-3 text-xs text-silt">
                          {r && <span className="max-w-[160px] truncate text-tide" title={r}>“{r}”</span>}
                          {p.payrollRun && <span>{p.payrollRun.count} in run</span>}
                          <span className="tabular" title={`block ${p.blockNumber} · ${p.txHash}`}>
                            {ago(p.timestamp, chainNow)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <p className="mt-3 text-xs text-silt">
                The lock is literal: an euint64 handle is a pointer to a TFHE ciphertext. Only the payer, the payee and the k-of-n KMS can open it, and this indexer never asks.
              </p>
            </section>

            <aside className="space-y-8">
              <section aria-labelledby="links">
                <h2 id="links" className="font-display text-xl font-bold">
                  Pay links
                </h2>
                <ul className="mt-4 space-y-2">
                  {s.PayLink.map((l) => (
                    <li key={l.id} className="flex items-center justify-between rounded-xl border border-kelp px-3 py-2.5 text-sm">
                      <span className="text-tide">
                        #{l.linkId} <span className="font-mono text-xs text-silt">{short(l.sender_id)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {l.claimSeconds !== null && <span className="tabular text-xs text-silt">{secs(l.claimSeconds)}</span>}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.state === "CLAIMED" ? "bg-sea-green/15 text-sea-green" : l.state === "OPEN" ? "bg-biolum-soft text-biolum" : "bg-trench-2 text-tide"}`}
                        >
                          {l.state.toLowerCase()}
                        </span>
                      </span>
                    </li>
                  ))}
                  {s.PayLink.length === 0 && <li className="text-sm text-silt">No links yet.</li>}
                </ul>
              </section>

              <section aria-labelledby="requests">
                <h2 id="requests" className="font-display text-xl font-bold">
                  Payment requests
                </h2>
                <p className="mt-1 text-xs text-silt">Encrypted invoices. The amount is a handle, and so is whether it is still owed: only the two parties can tell a paid request from a short one.</p>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["requests", "requests"],
                      ["requestPayAttempts", "pay attempts"],
                      ["requestsCancelled", "cancelled"],
                    ] as const
                  ).map(([k, l]) => (
                    <div key={k} className="flex flex-col-reverse rounded-xl border border-kelp px-2 py-2.5">
                      <dt className="text-[11px] text-silt">{l}</dt>
                      <dd className="font-display text-xl font-bold tabular text-foam">{fmt(n(g[k]))}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-3 space-y-2">
                  {(s.PayRequest ?? []).map((r) => {
                    const t = refText(r.ref);
                    const expired = !r.cancelled && r.expiry < chainNow;
                    return (
                      <li key={r.id} className="rounded-xl border border-kelp px-3 py-2.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-tide">
                            #{r.requestId}
                            <span className="truncate font-mono text-xs text-silt">
                              {short(r.payee_id)} <span aria-label="asks">→</span> {short(r.payer_id)}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.cancelled ? "bg-trench-2 text-tide" : expired ? "bg-trench-2 text-silt" : "bg-biolum-soft text-biolum"}`}
                            title={r.cancelled || expired ? undefined : "Open: whether anything is still owed is encrypted"}
                          >
                            {r.cancelled ? "cancelled" : expired ? "expired" : "open"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-silt">
                          <Sealed handle={r.dueHandle} />
                          {t && <span className="max-w-[120px] truncate text-tide" title={t}>“{t}”</span>}
                          <span className="tabular">{r.payAttempts} pay attempt{r.payAttempts === 1 ? "" : "s"}</span>
                          <span className="tabular">{ago(r.createdAt, chainNow)}</span>
                        </div>
                      </li>
                    );
                  })}
                  {!(s.PayRequest ?? []).length && <li className="text-sm text-silt">No requests yet.</li>}
                </ul>
              </section>

              <section aria-labelledby="reveals">
                <h2 id="reveals" className="font-display text-xl font-bold">
                  Reveals
                </h2>
                <p className="mt-1 text-xs text-silt">Request to on-chain callback. Only latency is indexed, never the cleartext.</p>
                <ul className="mt-4 space-y-2">
                  {s.Reveal.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-xl border border-kelp px-3 py-2.5 text-sm">
                      <span className="text-tide">
                        #{r.requestId} <span className="text-xs text-silt">{r.app}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs">
                        {r.status === "FULFILLED" ? (
                          <>
                            <span className="tabular text-foam">{secs(r.latencySeconds)}</span>
                            <span className="tabular text-silt">{r.latencyBlocks} blk</span>
                            <span className="rounded-full bg-trench-2 px-2 py-0.5 text-tide">{r.path === "CRE" ? "CRE" : "relayer"}</span>
                          </>
                        ) : (
                          <span className="rounded-full bg-biolum-soft px-2 py-0.5 text-biolum">pending</span>
                        )}
                      </span>
                    </li>
                  ))}
                  {s.Reveal.length === 0 && <li className="text-sm text-silt">No reveals yet.</li>}
                </ul>
              </section>

              <section aria-labelledby="fhe">
                <h2 id="fhe" className="font-display text-xl font-bold">
                  FHE coprocessor load
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {s.FheOpStat.map((o) => (
                    <li key={o.name} className="text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-xs text-tide">{o.name}</span>
                        <span className="tabular text-xs text-foam">{fmt(o.count)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-trench-2">
                        <div className="h-1.5 rounded-full bg-biolum/70" style={{ width: `${(o.count / maxOp) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>

          <p className="mt-12 text-xs text-silt">
            Indexed by Envio HyperIndex (indexer/ in this repo): {meta?.is_hyper_sync ? "HyperSync" : "RPC"} source, chain {meta?.chain_id}. Raw GraphQL at /api/indexer.
          </p>
        </>
      )}
    </div>
  );
}
