"use client";

import { DataTable, cn } from "@kakushi/ui";
import { ArrowDownRight, ArrowUpRight, Check, Compass, Gavel, Repeat, Star, Store, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CHAIN_LIST, chainById } from "@kakushi/config";
import { ChainCoin } from "@/components/coins";
import { Notice, readError, short } from "@/components/kit";
import { useIndexer, type ChainStat, type LeaderRow, type PointsView, type Quest } from "@/lib/engage";
import { useWallet } from "@/lib/wallet";

const CAT: Record<Quest["category"], { icon: React.ReactNode; label: string; tint: string }> = {
  bridge: { icon: <Repeat size={14} />, label: "Bridge", tint: "bg-[#16205a] text-[#c4d0ff]" },
  explore: { icon: <Compass size={14} />, label: "Explore", tint: "bg-[#10284a] text-[#8cc7ff]" },
  safety: { icon: <Gavel size={14} />, label: "Safety", tint: "bg-[#221a4a] text-[#b9a6ff]" },
  maker: { icon: <Store size={14} />, label: "Maker", tint: "bg-[#2e2414] text-[#f2c27a]" },
  social: { icon: <UserPlus size={14} />, label: "Social", tint: "bg-[#0f2a26] text-[#7fd6c0]" },
};

function PointsCard() {
  const w = useWallet();
  const p = useIndexer<PointsView>(w.address ? `points?address=${w.address.toLowerCase()}` : null, 10000);
  if (!w.address) {
    return (
      <div className="rounded-[24px] bg-[#04060f]/70 p-6 ring-1 ring-white/10 backdrop-blur">
        <div className="text-[14px] text-ui-muted">Your points</div>
        <div className="serif mt-2 text-[44px] leading-none text-ui-muted">—</div>
        <p className="mt-3 text-[14px] text-ui-muted">Connect a wallet</p>
      </div>
    );
  }
  const d = p.data;
  return (
    <div className="rounded-[24px] bg-[#04060f]/70 p-6 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center justify-between text-[14px] text-ui-muted">
        <span>Your points</span>
        <span className="font-mono text-[12px]">{short(w.address)}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <Star aria-hidden size={22} className="fill-[#f2c27a] text-[#f2c27a]" />
        <span className="serif text-[48px] leading-none">{d ? d.points.toLocaleString("en-US") : "—"}</span>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-[13px]">
        <div><dt className="text-ui-muted">Rank</dt><dd className="ui-figure mt-0.5 text-[17px] font-medium">{d?.rank ? `#${d.rank}` : "—"}</dd></div>
        <div><dt className="text-ui-muted">Transfers</dt><dd className="ui-figure mt-0.5 text-[17px] font-medium">{d ? d.transfers : "—"}</dd></div>
        <div><dt className="text-ui-muted">From referrals</dt><dd className="ui-figure mt-0.5 text-[17px] font-medium">{d ? d.referralPoints : "—"}</dd></div>
      </dl>
      {p.error ? <p className="mt-3 text-[13px] text-ui-warn">{readError(p.error)}</p> : null}
    </div>
  );
}

function TopChains() {
  const s = useIndexer<{ since: number; hours: number; items: ChainStat[] }>("stats/chains?hours=24", 30000);
  const items = s.data?.items.slice(0, 5) ?? [];
  const failed = Boolean(s.error) || (s.ready && !s.configured);
  return (
    <section aria-labelledby="top-title" className="mt-12">
      <h2 id="top-title" className="text-[20px] font-medium">Top chains in 24 h</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {(items.length ? items : failed ? CHAIN_LIST.slice(0, 5).map((c) => ({ chainId: c.chainId, transfers: 0, previous: 0, changePct: null, volumeByToken: {} }) as ChainStat) : Array.from({ length: 5 }, () => null)).map((c, i) => (
          <div key={c?.chainId ?? i} className="relative overflow-hidden rounded-[22px] bg-ui-surface-1/80 p-4 ring-1 ring-ui-hairline-strong backdrop-blur">
            <span className="serif absolute top-2 right-4 text-[40px] leading-none text-white/[0.06]">{i + 1}</span>
            {c ? (
              <>
                <div className="flex items-center gap-2.5">
                  <ChainCoin chainId={c.chainId} size={28} />
                  <span className="text-[14px] font-medium">{chainById(c.chainId).shortName}</span>
                </div>
                <div className="ui-figure mt-3 text-[22px] font-medium">{failed ? "—" : c.transfers.toLocaleString("en-US")} <span className="text-[13px] font-normal text-ui-muted">txs</span></div>
                <div className={cn("mt-1 inline-flex items-center gap-1 text-[13px]", c.changePct == null ? "text-ui-muted" : c.changePct >= 0 ? "text-[#7fd6a0]" : "text-ui-down")}>
                  {failed ? "no data" : c.changePct == null ? "new" : <>{c.changePct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(c.changePct).toFixed(1)}%</>}
                </div>
              </>
            ) : (
              <div className="h-[86px] animate-pulse rounded-[14px] bg-ui-surface-2/50" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Quests() {
  const w = useWallet();
  const q = useIndexer<{ items: Quest[] }>(`quests${w.address ? `?address=${w.address.toLowerCase()}` : ""}`, 15000);
  const items = q.data?.items ?? [];
  const done = items.filter((x) => x.completed).length;
  return (
    <section aria-labelledby="quests-title" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="quests-title" className="text-[20px] font-medium">Quests</h2>
        {items.length ? <span className="text-[14px] text-ui-muted">{done} of {items.length} complete</span> : null}
      </div>
      {q.error ? <Notice tone="warn" className="mt-4" title="Quests aren't available">{readError(q.error)}</Notice> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(items.length ? items : q.error || !q.configured ? [] : Array.from({ length: 6 }, () => null)).map((x, i) =>
          x ? (
            <article key={x.id} className={cn("flex flex-col rounded-[24px] p-5 ring-1 backdrop-blur", x.completed ? "bg-[#101a4a]/80 ring-[#3b55ff]/50" : "bg-ui-surface-1/80 ring-ui-hairline-strong")}>
              <div className="flex items-center justify-between">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", CAT[x.category].tint)}>
                  {CAT[x.category].icon}
                  {CAT[x.category].label}
                </span>
                <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#f2c27a]">
                  <Star aria-hidden size={13} className="fill-current" />+{x.points}
                </span>
              </div>
              <h3 className="mt-4 flex-1 text-[18px] font-medium" title={x.description}>{x.title}</h3>
              {x.progress ? (
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-[12px] text-ui-muted">
                    <span>{x.completed ? "Complete" : "Progress"}</span>
                    <span className="ui-figure">{Math.min(x.progress.current, x.progress.target)} / {x.progress.target}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ui-canvas">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#2f47f5,#8ea5ff)]" style={{ width: `${Math.min(100, (x.progress.current / Math.max(1, x.progress.target)) * 100)}%` }} />
                  </div>
                </div>
              ) : null}
              {x.completed ? (
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#c4d0ff]">
                  <Check aria-hidden size={15} /> Points credited
                </span>
              ) : (
                <Link href={x.category === "safety" ? "/disputes" : x.category === "maker" ? "/maker" : x.category === "social" && x.id.startsWith("refer") ? "/referral" : "/bridge"} className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-ui-surface-2 text-[14px] font-medium transition-colors hover:bg-ui-surface-3">
                  {x.category === "safety" ? "Open Claim" : x.category === "maker" ? "Become a Maker" : x.id.startsWith("refer") ? "Get your link" : "Bridge now"}
                </Link>
              )}
            </article>
          ) : (
            <div key={i} className="h-[210px] animate-pulse rounded-[24px] bg-ui-surface-1/60" />
          ),
        )}
      </div>
    </section>
  );
}

function Leaderboard() {
  const w = useWallet();
  const lb = useIndexer<{ total: number; items: LeaderRow[] }>("leaderboard?limit=20", 30000);
  const me = w.address?.toLowerCase();
  return (
    <section aria-labelledby="lb-title" className="mt-12">
      <div className="flex items-end justify-between">
        <h2 id="lb-title" className="text-[20px] font-medium">Leaderboard</h2>
        {lb.data ? <span className="text-[14px] text-ui-muted">{lb.data.total.toLocaleString("en-US")} wallets with points</span> : null}
      </div>
      <div className="mt-4 rounded-[28px] bg-ui-surface-1/80 p-4 ring-1 ring-ui-hairline-strong backdrop-blur sm:p-6">
        <DataTable
          caption="Points leaderboard"
          loading={lb.loading && !lb.data}
          loadingRows={6}
          rows={lb.data?.items ?? []}
          rowKey={(r) => r.address}
          empty={<p className="py-12 text-center text-[15px] text-ui-muted">{lb.error ? readError(lb.error) : "No points yet. The first bridge takes the top spot."}</p>}
          columns={[
            { key: "rank", header: "#", render: (r) => <span className={cn("serif text-[20px]", r.rank <= 3 ? "text-[#f2c27a]" : "text-ui-muted")}>{r.rank}</span> },
            { key: "addr", header: "Wallet", render: (r) => <span className={cn("font-mono text-[13px]", r.address === me && "text-[#c4d0ff]")}>{short(r.address, 6)}{r.address === me ? "  · you" : ""}</span> },
            { key: "transfers", header: "Transfers", align: "right", hideBelow: "sm", render: (r) => <span className="ui-figure">{r.transfers}</span> },
            { key: "points", header: "Points", align: "right", render: (r) => <span className="ui-figure font-medium">{r.points.toLocaleString("en-US")}</span> },
          ]}
        />
      </div>
    </section>
  );
}

export default function QuestsPage() {
  const probe = useIndexer<unknown>(null);
  return (
    <div className="mx-auto max-w-[1180px] pt-4 sm:pt-6">
      <section className="relative isolate overflow-hidden rounded-[32px] ring-1 ring-ui-hairline-strong">
        <Image src="/art/coins.webp" alt="" fill priority sizes="(min-width: 1280px) 1180px, 100vw" className="-z-20 object-cover object-[60%_65%]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#04060f_15%,rgb(4_6_15/0.75)_50%,rgb(4_6_15/0.35))]" />
        <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center lg:p-12">
          <div>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a5cf0] px-3 text-[13px] font-medium text-white">
              <Star aria-hidden size={13} className="fill-current" /> Season 1 · Testnet
            </span>
            <h1 className="mt-4 text-[clamp(40px,5.2vw,68px)] leading-[1.02]">Kakushi Quests</h1>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.5] text-ui-muted">Points from your own on-chain transfers.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/bridge" className="inline-flex h-12 items-center rounded-full bg-white px-6 text-[15px] font-medium text-[#13141f]">Bridge to earn</Link>
              <Link href="/referral" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] font-medium ring-1 ring-white/40 hover:bg-white/10">Invite friends</Link>
            </div>
          </div>
          <PointsCard />
        </div>
      </section>
      {probe.ready && !probe.configured ? <Notice tone="warn" className="mt-6" title="Points need the indexer">This deployment has no indexer configured yet, so points, quests and the leaderboard can&rsquo;t be computed.</Notice> : null}
      <TopChains />
      <Quests />
      <Leaderboard />
    </div>
  );
}
