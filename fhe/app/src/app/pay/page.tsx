"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { usePay } from "@/lib/pay/wallet";
import { cashOut, createPayLink, payPrivately } from "@/lib/pay/flows";
import { fromUnits, toUnits } from "@/lib/pay/core";
import type { SentTx } from "@/lib/pay/wallet";
import { Revealed } from "@/components/ui";
import { Heartbeat } from "@/components/pay/Heartbeat";
import { Settlement } from "@/components/pay/Settlement";
import { addrOk, amountOk, Card, Input, PrivyBanner, SignIn, Status, useAction, usePayEnv } from "@/components/pay/PayKit";
import { ActivityCard, BalanceCard, useBalances } from "@/components/pay/Wallet";
import { RequestFocus, RequestMoneyCard, RequestsCard, useRequests } from "@/components/pay/Requests";

/** `/pay?request=<id>`: the shareable link a payee sends to the payer. */
function useFocusRequest(): bigint | null {
  const [id, setId] = useState<bigint | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("request");
    if (v && /^\d{1,20}$/.test(v)) setId(BigInt(v));
  }, []);
  return id;
}

function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div role="tablist" aria-label="Payment type" className="inline-flex rounded-xl border border-kelp bg-abyss p-1">
      {items.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${value === k ? "bg-trench-2 text-foam" : "text-tide hover:text-foam"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function PayPage() {
  const pay = usePay();
  const env = usePayEnv();
  const w = pay.wallet;
  const { b, reload } = useBalances(env, w);
  const [revealed, setRevealed] = useState<Record<string, bigint>>({});
  const [tick, setTick] = useState(0);
  const refresh = async () => {
    await reload();
    setTick((t) => t + 1);
  };
  const focus = useFocusRequest();
  const req = useRequests(env, w?.address ?? null, focus);
  const refreshAll = async () => {
    await Promise.all([reload(), req.reload()]);
    setTick((t) => t + 1);
  };
  const focused = focus !== null ? req.items?.find((v) => v.id === focus) : undefined;
  const focusCard =
    env && focus !== null ? (
      <RequestFocus env={env} wallet={w} id={focus} v={focused} loading={req.items === null && !req.err} chainNow={req.chainNow} revealed={revealed} setRevealed={setRevealed} onChanged={refreshAll} />
    ) : null;

  const [mode, setMode] = useState<"send" | "link" | "out">("send");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("125");
  const [memo, setMemo] = useState("Dinner, Lisbon");
  const [days, setDays] = useState("7");
  const [sent, setSent] = useState<{ tx: SentTx; label: string } | null>(null);
  const [link, setLink] = useState<{ url: string; id: bigint; amount: string } | null>(null);
  const [released, setReleased] = useState<{ amount: bigint | null; asked: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const a = useAction();

  const ready = Boolean(env && w);
  const amountValid = amountOk(amt);

  async function go() {
    if (!env || !w) return;
    setSent(null);
    setLink(null);
    setReleased(null);
    await a.run(async (step) => {
      const v = toUnits(amt);
      if (mode === "send") {
        const r = await payPrivately(env, w, to.trim() as Hex, v, memo, step);
        setSent({ tx: r.sent, label: `Paid ${amt} cAUSD privately` });
      } else if (mode === "link") {
        const r = await createPayLink(env, w, v, Number(days) || 7, step);
        setLink({ url: r.url, id: r.id, amount: amt });
        setSent({ tx: r.sent, label: `Pay link #${r.id} escrowed` });
      } else {
        const r = await cashOut(env, w, v, step);
        setSent({ tx: r.sent, label: "Cash-out requested" });
        setReleased({ amount: null, asked: amt });
        step("Waiting for the KMS to reveal only this amount and release AUSD…");
        const got = await r.settled;
        setReleased({ amount: got, asked: amt });
      }
      await refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 sm:pt-12">
      <p className="font-mono text-sm text-biolum">Kakushi Confidential</p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Your money, your eyes only.</h1>
      <p className="mt-3 max-w-2xl text-tide">
        Real Agora AUSD on Monad, with amounts and balances encrypted end to end. Pay anyone, request money, send money by link to someone with no wallet yet, and cash out whenever you like. <Link href="/pay/employer" className="text-biolum hover:underline">Paying a team? Open Kakushi Payroll.</Link>
      </p>
      <div className="mt-6">
        <PrivyBanner />
      </div>

      {!env ? (
        <p className="mt-8 rounded-2xl border border-kelp p-6 text-tide">Loading the Kakushi Confidential deployment… If this stays, the stack is not running (cAUSD missing from contracts/deployments).</p>
      ) : !w ? (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="min-w-0 space-y-6">
            {focusCard}
            <SignIn why={focus !== null ? "Sign in to read and pay this request. Only its payer and requester can open the amount." : "Sign in to see payments sent to you, reveal your balance, and pay privately."} />
          </div>
          <Heartbeat rows={6} />
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0 space-y-6">
            {focusCard}
            <BalanceCard env={env} wallet={w} b={b} reload={reload} revealed={revealed} setRevealed={setRevealed} />
            <Card title="Move money" sub="The amount is encrypted in this tab before it leaves. The chain records that a payment happened, never how much." aside={<Tabs value={mode} onChange={(m) => { setMode(m); a.setError(null); }} items={[["send", "Pay"], ["link", "Pay link"], ["out", "Cash out"]]} />}>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void go();
                }}
              >
                {mode === "send" && <Input id="to" label="Recipient address" value={to} onChange={setTo} mono placeholder="0x…" />}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="amount" label={mode === "out" ? "Amount to cash out" : "Amount"} value={amt} onChange={(v) => setAmt(v.replace(/[^\d.,]/g, ""))} inputMode="decimal" suffix={mode === "out" ? "cAUSD" : "AUSD"} />
                  {mode === "send" && <Input id="memo" label="Public reference (optional)" value={memo} onChange={(v) => setMemo(v.slice(0, 31))} placeholder="Invoice 0042" />}
                  {mode === "link" && <Input id="days" label="Refundable after (days)" value={days} onChange={(v) => setDays(v.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />}
                </div>
                {mode === "link" && <p className="text-sm text-silt">Anyone holding the link can claim it to a new account, no wallet or gas needed. The key lives after the # in the link, which browsers never send to a server.</p>}
                {mode === "out" && <p className="text-sm text-silt">Only the amount you take out is ever decrypted (by the KMS, to release your AUSD). Your remaining balance stays private.</p>}
                {mode === "send" && memo && <p className="text-xs text-silt">The reference is public, so keep personal details out of it.</p>}
                <button
                  type="submit"
                  disabled={!ready || a.busy || !amountValid || (mode === "send" && !addrOk(to))}
                  className={`w-full rounded-xl px-5 py-3 font-semibold text-abyss transition hover:brightness-110 disabled:opacity-50 sm:w-auto ${mode === "out" ? "bg-lantern" : "bg-biolum"}`}
                >
                  {a.busy ? "Working…" : mode === "send" ? "Pay privately" : mode === "link" ? "Create pay link" : "Cash out to AUSD"}
                </button>
                {w.sponsored && <span className="ml-3 text-xs text-sea-green">Gas sponsored</span>}
              </form>
              <Status step={a.step} error={a.error} />
              {link && (
                <div className="rounded-2xl border border-biolum/30 bg-biolum-soft p-4">
                  <p className="text-sm font-semibold">Pay link #{link.id.toString()} for {link.amount} AUSD is live</p>
                  <div className="mt-2 flex gap-2">
                    <input readOnly value={link.url} aria-label="Pay link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-kelp bg-abyss px-2.5 py-2 font-mono text-xs text-foam" />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(link.url).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                      className="rounded-lg bg-biolum px-3 text-sm font-semibold text-abyss"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-tide">Send it over any chat. On-chain, the link holds a ciphertext; the amount is visible only to you and whoever claims it.</p>
                </div>
              )}
              {released && (
                <p className="text-sm" aria-live="polite">
                  {released.amount === null ? (
                    <span className="text-tide">Waiting for the KMS callback…</span>
                  ) : released.amount > 0n ? (
                    <>
                      Released <Revealed>{fromUnits(released.amount)} AUSD</Revealed> to your wallet. Nothing else was decrypted.
                    </>
                  ) : (
                    <span className="text-reef">Your private balance was below {released.asked}, so 0 was released (the contract never reveals why).</span>
                  )}
                </p>
              )}
              {sent && env && <Settlement tx={sent.tx} client={env.client} network={env.network} label={sent.label} />}
            </Card>
            <RequestMoneyCard env={env} wallet={w} onCreated={refreshAll} />
          </div>
          <div className="min-w-0 space-y-6">
            <RequestsCard env={env} wallet={w} items={req.items} chainNow={req.chainNow} err={req.err} revealed={revealed} setRevealed={setRevealed} onChanged={refreshAll} />
            <ActivityCard env={env} wallet={w} revealed={revealed} setRevealed={setRevealed} refreshKey={tick} title="Payments" />
            <Heartbeat rows={5} compact />
          </div>
        </div>
      )}
    </div>
  );
}
