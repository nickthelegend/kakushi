"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { receiptLogIndex } from "@/lib/receipt-selection";
import { CheckCircle2, CircleDashed, Gavel, ShieldCheck, Timer, XCircle } from "lucide-react";
import type { Hex } from "viem";
import { chainById } from "@kakushi/config";
import { Amount, Button, Card, ChainName, Notice, Pill, Spinner, TxLink, cn, short, PageHeader } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { useTransfer } from "@/lib/useTransfer";

type StepState = "done" | "active" | "pending" | "bad";

function Step({ state, icon, title, children, last }: { state: StepState; icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; last?: boolean }) {
  const color = state === "done" ? "text-ok" : state === "active" ? "text-accent" : state === "bad" ? "text-bad" : "text-dim";
  return (
    <li className="relative flex gap-4 pb-7">
      {!last && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-line-strong" />}
      <span className={cn("mt-0.5 shrink-0", color)}>
        {icon ?? (state === "done" ? <CheckCircle2 className="size-7" /> : state === "bad" ? <XCircle className="size-7" /> : state === "active" ? <Spinner className="size-7 text-accent" /> : <CircleDashed className="size-7" />)}
      </span>
      <div className="min-w-0 pt-1">
        <div className={cn("font-medium", state === "pending" && "text-muted")}>{title}</div>
        {children && <div className="mt-1 space-y-1 text-sm text-muted">{children}</div>}
      </div>
    </li>
  );
}

export default function TxPage({ params }: { params: Promise<{ chainId: string; hash: string }> }) {
  const p = use(params);
  const chainId = Number(p.chainId);
  const hash = p.hash as Hex;
  const { cfg, makerUrls } = useRuntime();
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
  const slashed = v.dispute?.status === 3 || v.watch?.status === "slashed";
  void makerUrls;

  async function askWatchtower() {
    setAsked("asking…");
    const r = await fetch("/api/svc/watchtower/watch", { method: "POST", body: JSON.stringify({ chainId, txHash: hash }) });
    const j = await r.json();
    setAsked(r.ok ? "The Watchtower is watching this transfer." : (j.error ?? "Watchtower unavailable"));
  }

  return (
    <div className="mx-auto max-w-3xl">
      {selectedLog === null && <Notice tone="bad">Invalid receipt log index.</Notice>}
      <PageHeader
        title="Transfer"
        subtitle={<span className="font-mono text-sm break-all">{hash}</span>}
        right={pay && c ? (slashed ? <Pill tone="indigo">Compensated from margin</Pill> : v.payout && !lateOrWrong ? <Pill tone="ok">{c.kind === 2 ? "Refunded" : "Settled"}</Pill> : overdue || lateOrWrong ? <Pill tone="bad">Maker missed the deadline</Pill> : <Pill tone="accent">In flight</Pill>) : null}
      />
      {v.error && <Notice tone="warn">{v.error}</Notice>}
      {v.notFound && <Notice tone="bad">This transaction is not a Kakushi payment to a registered Maker on {chainById(chainId).shortName}.</Notice>}
      {!pay && !v.notFound && (
        <Card className="flex items-center gap-3"><Spinner /> Reading the payment…</Card>
      )}
      {pay && c && (
        <Card>
          <ol>
            <Step state="done" title={<>Paid <Amount value={pay.gross} decimals={dec} symbol={sym} /> on <ChainName chainId={pay.srcChainId} /></>}>
              <div>to {makerName} · {pay.via === "source-router" ? "via the SourceRouter" : "a plain transfer to the Maker's address"} · code <span className="font-mono text-accent">{pay.gross.toString().slice(-4)}</span></div>
              <div className="flex flex-wrap gap-x-3"><TxLink chainId={pay.srcChainId} hash={pay.txHash} network={network} /> <span>block {pay.blockNumber.toString()}</span></div>
            </Step>
            <Step state="done" title={c.kind === 1 ? <>The hub says: {makerName} owes {pay.recipient.toLowerCase() === pay.sender.toLowerCase() ? "you" : short(pay.recipient)} <Amount value={c.expected} decimals={dec} symbol={sym} /> on <ChainName chainId={c.obligationChainId} /></> : c.kind === 2 ? <>Unroutable code: {makerName} must refund <Amount value={c.expected} decimals={dec} symbol={sym} /> on <ChainName chainId={c.obligationChainId} /></> : "No obligation (top-up code or dust)"}>
              <div>Rules read from the EBC on Monad at the payment time · deadline {v.deadline ? new Date(Number(v.deadline) * 1000).toLocaleTimeString() : "…"}</div>
            </Step>
            {c.kind !== 0 && (
              <Step
                state={v.payout ? (lateOrWrong ? "bad" : "done") : overdue ? "bad" : "active"}
                icon={!v.payout && !overdue ? <Timer className="size-7 text-accent" /> : undefined}
                title={v.payout ? (lateOrWrong ? "Payout arrived but is non-compliant" : <>Paid out <Amount value={v.payout.amount} decimals={dec} symbol={sym} /> {Number(v.payout.timestamp - pay.timestamp) >= 0 ? `${Number(v.payout.timestamp - pay.timestamp)} s after your payment` : ""}</>) : overdue ? "No payout before the deadline" : `Waiting for ${makerName} · ${Math.max(0, Number((v.deadline ?? 0n) - nowS))} s left`}
              >
                {v.payout && <div className="flex flex-wrap gap-x-3"><TxLink chainId={c.obligationChainId} hash={v.payout.txHash} network={network} /> <span>via PayoutRouter</span></div>}
              </Step>
            )}
            {c.kind !== 0 && (
              <Step state={attested ? "done" : slashed ? "done" : v.coveredUntil && v.deadline && v.coveredUntil >= v.deadline ? "done" : "active"} icon={<ShieldCheck className={cn("size-7", attested || slashed ? "text-indigo" : "text-dim")} />} title={attested ? "Attested by Chainlink CRE" : v.coveredUntil && v.deadline && v.coveredUntil >= v.deadline ? "CRE attestation covers the deadline" : "Waiting for CRE attestation"}>
                <div>{chainById(c.obligationChainId).shortName} payouts attested up to {v.coveredUntil ? new Date(Number(v.coveredUntil) * 1000).toLocaleTimeString() : "…"} {network === "local" && "(local CRE runner)"}</div>
              </Step>
            )}
            {(overdue || lateOrWrong || v.watch?.disputeKey || (v.dispute && v.dispute.status !== 0)) && (
              <Step last state={slashed ? "done" : "active"} icon={<Gavel className={cn("size-7", slashed ? "text-ok" : "text-accent")} />} title={slashed ? <>Margin slashed: you received <Amount value={pay.gross} decimals={dec} symbol={sym} />{dec === 18 ? " in USDC at the Chainlink price" : ""} on Monad</> : "Dispute"}>
                {v.watch && <div>Watchtower: {v.watch.status}{v.watch.note ? ` · ${v.watch.note}` : ""}{v.watch.proofMs ? ` · proof ${v.watch.proofMs} ms` : ""}</div>}
                {v.watch?.proveTx && <div><TxLink chainId={10143} hash={v.watch.proveTx} network={network} /> PaymentCompliance proof verified on Monad</div>}
                {!slashed && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="indigo" className="h-9 px-4 text-sm" onClick={askWatchtower}>Ask the Watchtower to prove it</Button>
                    <Link href={`/disputes?chain=${chainId}&tx=${hash}&log=${pay.logIndex}`}><Button variant="ghost" className="h-9 px-4 text-sm">Dispute it myself</Button></Link>
                  </div>
                )}
                {asked && <div className="text-xs">{asked}</div>}
              </Step>
            )}
          </ol>
        </Card>
      )}
      {pay && (
        <div className="mt-4 text-xs text-dim">srcRef <span className="font-mono break-all">{v.srcRef}</span></div>
      )}
    </div>
  );
}
