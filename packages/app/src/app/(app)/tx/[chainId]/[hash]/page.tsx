"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Gavel, Loader2, ShieldCheck, Timer, X } from "lucide-react";
import type { Hex } from "viem";
import { PanelCard, PrimaryButton, SecondaryButton, cn } from "@kakushi/ui";
import { chainById } from "@kakushi/config";
import { receiptLogIndex } from "@/lib/receipt-selection";
import { Amount, ChainName, ChainTx, Loading, Notice, PageHead, Pill, readError, short } from "@/components/kit";
import { useRuntime } from "@/lib/runtime";
import { useTransfer } from "@/lib/useTransfer";

type StepState = "done" | "active" | "pending" | "bad";

function Step({ state, icon, title, tag, children, last }: { state: StepState; icon?: React.ReactNode; title: React.ReactNode; tag?: React.ReactNode; children?: React.ReactNode; last?: boolean }) {
  const disc = state === "done" ? "bg-ui-lime-button text-ui-on-lime" : state === "bad" ? "bg-ui-pill-red text-ui-pill-red-text" : state === "active" ? "bg-ui-pill-teal text-ui-pill-teal-text" : "bg-ui-surface-2 text-ui-muted";
  return (
    <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4 pb-7 last:pb-0">
      {!last && <span aria-hidden className="absolute top-10 bottom-1 left-[17.5px] w-px bg-ui-hairline-strong" />}
      <span className={cn("relative z-10 grid size-9 place-items-center rounded-full", disc)}>
        {icon ?? (state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : state === "bad" ? <X className="size-4" strokeWidth={2.5} /> : state === "active" ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />)}
      </span>
      <div className="min-w-0 pt-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className={cn("text-[17px] font-medium tracking-[-0.01em]", state === "pending" && "text-ui-muted")}>{title}</div>
          {tag}
        </div>
        {children && <div className="mt-1.5 grid gap-1 text-[14px] text-ui-muted">{children}</div>}
      </div>
    </li>
  );
}

export default function TxPage({ params }: { params: Promise<{ chainId: string; hash: string }> }) {
  const p = use(params);
  const chainId = Number(p.chainId);
  const hash = p.hash as Hex;
  const { cfg } = useRuntime();
  const selectedLog = receiptLogIndex(useSearchParams().get("log"));
  const v = useTransfer(chainId, hash, selectedLog === null ? NaN : selectedLog);
  const [asked, setAsked] = useState<string | null>(null);
  const network = cfg?.network ?? "local";
  const pay = v.payment;
  const c = v.c;
  const makerName = cfg?.makers.find((m) => pay && m.address.toLowerCase() === pay.maker.toLowerCase())?.name ?? (pay ? short(pay.maker) : "");
  const dec = pay && pay.token === "0x0000000000000000000000000000000000000000" ? 18 : 6;
  const sym = dec === 18 ? "ETH" : "USDC";
  const nowS = BigInt(Math.floor(v.now / 1000));
  const overdue = !!(v.deadline && nowS > v.deadline && !v.payout);
  const lateOrWrong = !!(v.payout && c && v.deadline && (v.payout.timestamp > v.deadline || v.payout.amount < c.expected));
  const attested = !!(v.coveredUntil && v.payout && v.coveredUntil >= v.payout.timestamp);
  const coversDeadline = !!(v.coveredUntil && v.deadline && v.coveredUntil >= v.deadline);
  const slashed = v.dispute?.status === 3 || v.watch?.status === "slashed";

  async function askWatchtower() {
    setAsked("Asking…");
    const r = await fetch("/api/svc/watchtower/watch", { method: "POST", body: JSON.stringify({ chainId, txHash: hash }) });
    const j = await r.json();
    setAsked(r.ok ? "The Watchtower is watching this transfer." : (j.error ?? "Watchtower unavailable"));
  }

  const status = pay && c ? (slashed ? <Pill tone="indigo">Paid from margin</Pill> : v.payout && !lateOrWrong ? <Pill tone="ok">{c.kind === 2 ? "Refunded" : "Settled"}</Pill> : overdue || lateOrWrong ? <Pill tone="bad">Maker missed the deadline</Pill> : <Pill tone="accent">In flight</Pill>) : null;

  return (
    <div className="mx-auto max-w-[860px]">
      <PageHead
        eyebrow={<Link href="/explorer" className="text-[14px] text-ui-muted hover:text-ui-text">← Activity</Link>}
        title="Transfer"
        sub={<span className="font-mono text-[13px] break-all">{hash}</span>}
        right={status}
      />
      {selectedLog === null && <Notice tone="bad">Invalid receipt log index.</Notice>}
      {v.error && <Notice tone="warn" title="This transfer can't be read">{/internal error/i.test(v.error) ? "The chain RPC for this network isn't reachable right now." : readError(v.error)}</Notice>}
      {v.notFound && <Notice tone="bad">This transaction is not a Kakushi payment to a registered Maker on {chainById(chainId).shortName}.</Notice>}
      {!pay && !v.notFound && !v.error && <Loading>Reading the payment…</Loading>}
      {pay && c && (
        <PanelCard title={<Amount value={pay.gross} decimals={dec} symbol={sym} className="text-[28px] tracking-[-0.03em]" />} subtitle={<>to {makerName} on <ChainName chainId={pay.srcChainId} size={16} /></>} badge={<span className="ui-figure rounded-full bg-ui-canvas px-3 py-1 text-[13px]">Code <span className="code-digits">{pay.gross.toString().slice(-4)}</span></span>}>
          <ol className="mt-2">
            <Step state="done" title={<>Paid on {chainById(pay.srcChainId).shortName}</>} tag={<Pill>block {pay.blockNumber.toString()}</Pill>}>
              <div>To {makerName}, {pay.via === "source-router" ? "through the SourceRouter" : "as a plain transfer to its address"}.</div>
              <div><ChainTx chainId={pay.srcChainId} hash={pay.txHash} network={network} /></div>
            </Step>
            <Step
              state="done"
              title={c.kind === 1 ? <>The hub says {makerName} owes {pay.recipient.toLowerCase() === pay.sender.toLowerCase() ? "you" : short(pay.recipient)} <Amount value={c.expected} decimals={dec} symbol={sym} /></> : c.kind === 2 ? <>Unroutable code: {makerName} must refund <Amount value={c.expected} decimals={dec} symbol={sym} /></> : "No obligation (top-up code or dust)"}
              tag={c.kind !== 0 ? <ChainName chainId={c.obligationChainId} size={18} /> : undefined}
            >
              <div>Judged by the rules on Monad at the time you paid. Deadline {v.deadline ? new Date(Number(v.deadline) * 1000).toLocaleTimeString() : "…"}.</div>
            </Step>
            {c.kind !== 0 && (
              <Step
                state={v.payout ? (lateOrWrong ? "bad" : "done") : overdue ? "bad" : "active"}
                icon={!v.payout && !overdue ? <Timer className="size-4" /> : undefined}
                title={v.payout ? (lateOrWrong ? "Payout arrived, but late or short" : <>Paid out <Amount value={v.payout.amount} decimals={dec} symbol={sym} /></>) : overdue ? "No payout before the deadline" : `Waiting for ${makerName}`}
                tag={v.payout && !lateOrWrong && v.payout.timestamp >= pay.timestamp ? <Pill tone="ok">{`${Number(v.payout.timestamp - pay.timestamp)} s`}</Pill> : !v.payout && !overdue ? <Pill tone="accent">{`${Math.max(0, Number((v.deadline ?? 0n) - nowS))} s left`}</Pill> : undefined}
              >
                {v.payout && <div className="flex flex-wrap gap-x-3"><ChainTx chainId={c.obligationChainId} hash={v.payout.txHash} network={network} /> <span>through the PayoutRouter</span></div>}
              </Step>
            )}
            {c.kind !== 0 && (
              <Step
                last={!(overdue || lateOrWrong || v.watch?.disputeKey || (v.dispute && v.dispute.status !== 0))}
                state={attested || slashed || coversDeadline ? "done" : "active"}
                icon={<ShieldCheck className="size-4" />}
                title={attested ? "Attested by Chainlink CRE" : coversDeadline ? "CRE attestation covers the deadline" : "Waiting for the CRE attestation"}
                tag={network === "local" ? <Pill tone="warn">local CRE runner</Pill> : <Pill tone="indigo">Chainlink CRE</Pill>}
              >
                <div>{chainById(c.obligationChainId).shortName} payouts attested up to {v.coveredUntil ? new Date(Number(v.coveredUntil) * 1000).toLocaleTimeString() : "…"}.</div>
              </Step>
            )}
            {(overdue || lateOrWrong || v.watch?.disputeKey || (v.dispute && v.dispute.status !== 0)) && (
              <Step last state={slashed ? "done" : "active"} icon={<Gavel className="size-4" />} title={slashed ? <>Paid from margin: <Amount value={pay.gross} decimals={dec} symbol={sym} />{dec === 18 ? " in USDC at the Chainlink price" : ""} on Monad</> : "Dispute"} tag={<Pill tone="indigo">Noir proof</Pill>}>
                {v.watch && <div>Watchtower: {v.watch.status}{v.watch.note ? `, ${v.watch.note}` : ""}{v.watch.proofMs ? `. Proof generated in ${v.watch.proofMs} ms.` : ""}</div>}
                {v.watch?.proveTx && <div><ChainTx chainId={10143} hash={v.watch.proveTx} network={network} /> PaymentCompliance proof verified on Monad</div>}
                {!slashed && (
                  <div className="flex flex-wrap gap-2 pt-3">
                    <PrimaryButton size="sm" icon={<ShieldCheck />} onClick={askWatchtower}>Ask the Watchtower to prove it</PrimaryButton>
                    <SecondaryButton asChild size="sm" icon={<Gavel />}>
                      <Link href={`/disputes?chain=${chainId}&tx=${hash}&log=${pay.logIndex}`}>Prove it myself</Link>
                    </SecondaryButton>
                  </div>
                )}
                {asked && <div className="text-[13px]">{asked}</div>}
              </Step>
            )}
          </ol>
        </PanelCard>
      )}
      {pay && <p className="mt-4 text-[12px] text-ui-muted">srcRef <span className="font-mono break-all">{v.srcRef}</span></p>}
    </div>
  );
}
