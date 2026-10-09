"use client";

import { CopyButton, PrimaryButton } from "@kakushi/ui";
import { Gift, Link2, Star, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice, readError, short } from "@/components/kit";
import { bindReferral, referralMessage, useIndexer, type ReferralView } from "@/lib/engage";
import { useStoredReferrer } from "@/lib/referral";
import { useWallet } from "@/lib/wallet";

export default function ReferralPage() {
  const w = useWallet();
  const me = w.address?.toLowerCase() ?? null;
  const [stored, setStored] = useStoredReferrer();
  const r = useIndexer<ReferralView>(me ? `referral?address=${me}` : null, 10000);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  useEffect(() => setOrigin(location.origin), []);
  const link = me ? `${origin}/bridge?ref=${me}` : "";
  const canBind = Boolean(me && stored && stored !== me && r.data && !r.data.referrer);

  async function confirm() {
    if (!me || !stored || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const wc = await w.walletClient("monadTestnet");
      const signature = await wc.signMessage({ account: wc.account!, message: referralMessage(stored, me) });
      await bindReferral({ referee: me, referrer: stored, signature });
      setStored(null);
      setMsg({ tone: "ok", text: `Referral saved. ${short(stored)} earns 10% of your transfer points.` });
    } catch (e) {
      setMsg({ tone: "bad", text: (e as { shortMessage?: string }).shortMessage ?? readError((e as Error).message) ?? "Referral could not be saved" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[980px] pt-6 sm:pt-10">
      <header className="text-center">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a5cf0] px-3 text-[13px] font-medium text-white">
          <Gift aria-hidden size={13} /> Referral
        </span>
        <h1 className="mt-4 text-[clamp(40px,5.5vw,68px)] leading-[1.02]">Invite friends.<br />Earn 10% of their points.</h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-[16px] text-ui-muted">Share your link. When a new wallet confirms you as its referrer and bridges, you earn a tenth of the points it makes from transfers, for good.</p>
      </header>

      {r.ready && !r.configured ? <Notice tone="warn" className="mt-8" title="Referrals need the indexer">This deployment has no indexer configured yet.</Notice> : null}

      <div className="mt-10 grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="rounded-[28px] bg-ui-surface-1/80 p-6 ring-1 ring-ui-hairline-strong backdrop-blur">
          <h2 className="flex items-center gap-2 text-[17px] font-medium"><Link2 aria-hidden size={18} /> Your link</h2>
          {me ? (
            <div className="mt-4 flex items-center gap-2 rounded-full bg-ui-canvas py-1.5 pr-1.5 pl-4 ring-1 ring-ui-hairline">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{link}</span>
              <CopyButton value={link} label="referral link" variant="button" />
            </div>
          ) : (
            <p className="mt-4 text-[15px] text-ui-muted">Connect a wallet to get your link.</p>
          )}
          <dl className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-[18px] bg-ui-canvas p-4"><dt className="flex items-center gap-1.5 text-[13px] text-ui-muted"><Users size={13} /> Invited</dt><dd className="serif mt-1 text-[30px] leading-none">{r.data ? r.data.referees : "—"}</dd></div>
            <div className="rounded-[18px] bg-ui-canvas p-4"><dt className="flex items-center gap-1.5 text-[13px] text-ui-muted"><UserPlus size={13} /> Bridged</dt><dd className="serif mt-1 text-[30px] leading-none">{r.data ? r.data.activeReferees : "—"}</dd></div>
            <div className="rounded-[18px] bg-ui-canvas p-4"><dt className="flex items-center gap-1.5 text-[13px] text-ui-muted"><Star size={13} /> Earned</dt><dd className="serif mt-1 text-[30px] leading-none">{r.data ? r.data.points : "—"}</dd></div>
          </dl>
          {r.error ? <p className="mt-3 text-[13px] text-ui-warn">{readError(r.error)}</p> : null}
        </section>

        <section className="rounded-[28px] bg-ui-surface-1/80 p-6 ring-1 ring-ui-hairline-strong backdrop-blur">
          <h2 className="text-[17px] font-medium">Were you invited?</h2>
          {r.data?.referrer ? (
            <p className="mt-3 text-[15px] text-ui-muted">Your referrer is <span className="font-mono text-ui-text">{short(r.data.referrer)}</span>. It earns 10% of your transfer points.</p>
          ) : stored && stored !== me ? (
            <>
              <p className="mt-3 text-[15px] text-ui-muted">You opened a link from <span className="font-mono text-ui-text">{short(stored)}</span>. Confirm it by signing a message: no transaction, no gas. Only wallets that haven&rsquo;t bridged yet can be referred.</p>
              <PrimaryButton size="lg" block className="mt-5" icon={<UserPlus />} loading={busy} disabled={!canBind} onClick={confirm}>
                {me ? "Confirm referral" : "Connect a wallet first"}
              </PrimaryButton>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-ui-muted">Open a friend&rsquo;s Kakushi link before your first bridge and confirm it here. Then <Link href="/bridge" className="text-ui-lime-text hover:underline">make your first transfer</Link>.</p>
          )}
          {msg ? <p className={`mt-3 text-[14px] ${msg.tone === "ok" ? "text-[#c4d0ff]" : "text-ui-down"}`}>{msg.text}</p> : null}
        </section>
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Share your link", "Anyone who opens it before their first bridge can confirm you."],
          ["2", "They sign once", "A free message signature binds you as their referrer. It can't change later."],
          ["3", "You earn 10%", "A tenth of every transfer point they make is added to yours."],
        ].map(([n, t, b]) => (
          <div key={n} className="rounded-[22px] bg-ui-surface-1/60 p-5 ring-1 ring-ui-hairline">
            <span className="serif text-[28px] text-[#8ea5ff]">{n}</span>
            <h3 className="mt-1 text-[16px] font-medium">{t}</h3>
            <p className="mt-1 text-[14px] text-ui-muted">{b}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
