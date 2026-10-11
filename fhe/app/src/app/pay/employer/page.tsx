"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useRt } from "@/lib/runtime";
import { usePay, type SentTx } from "@/lib/pay/wallet";
import { authorizeOperator, operatorUntil, runPayrollDirect, runPayrollViaOperator, wrap, type PayrollRow } from "@/lib/pay/flows";
import { fromUnits, isZeroHandle, short, toUnits } from "@/lib/pay/core";
import { describePolicy } from "@/lib/pay/policy";
import { Heartbeat } from "@/components/pay/Heartbeat";
import { Settlement } from "@/components/pay/Settlement";
import { addrOk, amountOk, Card, Input, PrivyBanner, SignIn, Status, useAction, usePayEnv } from "@/components/pay/PayKit";
import { ActivityCard, BalanceCard, useBalances } from "@/components/pay/Wallet";

interface Row {
  id: number;
  name: string;
  to: string;
  salary: string;
}

let nextId = 1;
const row = (name: string, to: string, salary: string): Row => ({ id: nextId++, name, to, salary });

function period() {
  const d = new Date();
  return `payroll ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function EmployerPage() {
  const rt = useRt();
  const pay = usePay();
  const env = usePayEnv();
  const w = pay.wallet;
  const { b, reload } = useBalances(env, w);
  const [revealed, setRevealed] = useState<Record<string, bigint>>({});
  const [tick, setTick] = useState(0);
  const refresh = useCallback(async () => {
    await reload();
    setTick((t) => t + 1);
  }, [reload]);

  // ----------------------------------------------------------------- wrap
  const [wrapAmt, setWrapAmt] = useState("5000");
  const wa = useAction();
  const [wrapTx, setWrapTx] = useState<SentTx | null>(null);

  // ----------------------------------------------------------------- payroll table
  const [rows, setRows] = useState<Row[]>([]);
  const [ref, setRef] = useState(period());
  useEffect(() => {
    if (rows.length || !rt.cfg) return;
    // on the fork, prefill with the dev accounts (bob and carol) so the demo is one click
    const ks = rt.cfg.localKeys;
    if (ks.length >= 3) setRows([row("Bob", privateKeyToAccount(ks[1]!.key).address, "3200"), row("Carol", privateKeyToAccount(ks[2]!.key).address, "1150")]);
    else setRows([row("", "", "")]);
  }, [rt.cfg, rows.length]);
  const valid = rows.length > 0 && rows.every((r) => addrOk(r.to) && amountOk(r.salary));
  const total = useMemo(() => rows.reduce((s, r) => (amountOk(r.salary) ? s + toUnits(r.salary) : s), 0n), [rows]);
  const parsed = (): PayrollRow[] => rows.map((r) => ({ to: r.to.trim() as Hex, amount: toUnits(r.salary) }));
  const set = (id: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));

  const pa = useAction();
  const [payTx, setPayTx] = useState<{ tx: SentTx; label: string } | null>(null);

  // ----------------------------------------------------------------- operator
  const op = rt.cfg?.pay?.operator ?? null;
  const [until, setUntil] = useState<number | null>(null);
  const oa = useAction();
  const [job, setJob] = useState<{ id: string; runAt: number; status: string; error?: string } | null>(null);
  const [delay, setDelay] = useState("1");
  const loadUntil = useCallback(async () => {
    if (env && w && op) setUntil(await operatorUntil(env, w.address, op.address));
  }, [env, w, op]);
  useEffect(() => {
    void loadUntil().catch(() => {});
  }, [loadUntil]);
  const now = Math.floor(Date.now() / 1000);
  const authorized = until !== null && until > now;

  // poll a scheduled job until it ran
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed" || !env) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/payroll/run?job=${job.id}`).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setJob((j) => (j ? { ...j, status: r.status, error: r.error } : j));
      if (r.status === "done" && r.result?.hash) {
        const receipt = await env.client.getTransactionReceipt({ hash: r.result.hash });
        setPayTx({ tx: { hash: r.result.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receipt, submittedAt: job.runAt, receiptMs: r.result.receiptMs, via: r.result.via, sync: r.result.sync }, label: "Scheduled payroll ran while you were away" });
        void refresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job, env, refresh]);

  async function viaOperator(runAt: number | null) {
    if (!env || !w || !op) return;
    setPayTx(null);
    setJob(null);
    await oa.run(async (step) => {
      const submittedAt = Date.now();
      const r = await runPayrollViaOperator(env, w, op.address, parsed(), ref, runAt, step);
      if (r.scheduled) {
        setJob({ id: r.scheduled.id, runAt: r.scheduled.runAt, status: "scheduled" });
        return;
      }
      const receipt = await env.client.getTransactionReceipt({ hash: r.hash! });
      setPayTx({ tx: { hash: r.hash!, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receipt, submittedAt, receiptMs: Date.now() - submittedAt, via: r.via as SentTx["via"], sync: Boolean(r.sync) }, label: `Payroll for ${rows.length} run by the operator` });
      await refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 sm:pt-12">
      <p className="font-mono text-sm text-biolum">Kakushi Payroll</p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Payroll nobody can read.</h1>
      <p className="mt-3 max-w-2xl text-tide">
        Pay the whole team in one Monad transaction. Every salary is encrypted in this browser; on-chain, each one is a ciphertext that only you and that employee can open. Colleagues, competitors and block explorers see that payroll ran, not who earns what.{" "}
        <Link href="/pay" className="text-biolum hover:underline">Employees: see your pay</Link>
      </p>
      <div className="mt-6">
        <PrivyBanner />
      </div>

      {!env ? (
        <p className="mt-8 rounded-2xl border border-kelp p-6 text-tide">Loading the Kakushi Confidential deployment…</p>
      ) : !w ? (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          <SignIn why="Sign in as the employer. On the fork, Alice is funded with AUSD and is the natural employer; Bob and Carol are the employees." />
          <Heartbeat rows={6} />
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="min-w-0 space-y-6">
            <BalanceCard env={env} wallet={w} b={b} reload={reload} revealed={revealed} setRevealed={setRevealed} />

            <Card title="1 · Fund payroll" sub={w.kind === "privy" ? "Wrap public AUSD into confidential cAUSD. Approve and wrap are both gas-sponsored by Privy." : "Wrap public AUSD into confidential cAUSD with one ERC-2612 permit signature and one transaction."}>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setWrapTx(null);
                  void wa.run(async (step) => {
                    setWrapTx(await wrap(env, w, toUnits(wrapAmt), step));
                    await refresh();
                  });
                }}
              >
                <div className="min-w-40 flex-1">
                  <Input id="wrap" label="Amount" value={wrapAmt} onChange={(v) => setWrapAmt(v.replace(/[^\d.,]/g, ""))} inputMode="decimal" suffix="AUSD" />
                </div>
                <button disabled={wa.busy || !amountOk(wrapAmt)} className="rounded-xl bg-biolum px-5 py-2.5 font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
                  {wa.busy ? "Wrapping…" : "Wrap to cAUSD"}
                </button>
              </form>
              <p className="text-xs text-silt">Wrapping is the one public step: the chain sees AUSD go in. From here on, every amount is encrypted.</p>
              <Status step={wa.step} error={wa.error} />
              {wrapTx && <Settlement tx={wrapTx} client={env.client} network={env.network} label="Wrapped" />}
            </Card>

            <Card title="2 · Salaries" sub="Encrypted one by one in this tab when you run payroll. The total below never leaves your screen.">
              <div className="space-y-3">
                <div className="hidden grid-cols-[0.8fr_1.8fr_1fr_auto] gap-2 px-1 text-xs text-silt sm:grid">
                  <span>Name (local only)</span>
                  <span>Employee address</span>
                  <span>Salary (AUSD)</span>
                  <span className="w-8" />
                </div>
                {rows.map((r, i) => (
                  <div key={r.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-kelp p-2 sm:grid-cols-[0.8fr_1.8fr_1fr_auto] sm:border-0 sm:p-0">
                    <input aria-label={`Name, row ${i + 1}`} value={r.name} placeholder="Name" onChange={(e) => set(r.id, "name", e.target.value)} className="rounded-lg border border-kelp bg-abyss px-2.5 py-2 text-sm outline-none focus:border-biolum" />
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label={`Remove row ${i + 1}`} className="rounded-lg px-2 text-silt hover:bg-trench-2 hover:text-reef sm:order-last">
                      ×
                    </button>
                    <input aria-label={`Employee address, row ${i + 1}`} value={r.to} placeholder="0x…" onChange={(e) => set(r.id, "to", e.target.value.trim())} className={`col-span-2 rounded-lg border bg-abyss px-2.5 py-2 font-mono text-xs outline-none focus:border-biolum sm:col-span-1 ${r.to && !addrOk(r.to) ? "border-reef" : "border-kelp"}`} />
                    <input aria-label={`Salary, row ${i + 1}`} value={r.salary} inputMode="decimal" placeholder="0.00" onChange={(e) => set(r.id, "salary", e.target.value.replace(/[^\d.,]/g, ""))} className="col-span-2 rounded-lg border border-kelp bg-abyss px-2.5 py-2 text-sm tabular outline-none focus:border-biolum sm:col-span-1" />
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, row("", "", "")])} className="rounded-lg border border-kelp-strong px-3 py-1.5 text-sm hover:bg-trench-2 disabled:opacity-40">
                    Add employee
                  </button>
                  <p className="text-sm text-tide">
                    Total this run: <span className="font-semibold tabular text-foam">{fromUnits(total)} AUSD</span>
                  </p>
                </div>
                <Input id="ref" label="Public reference for this run" value={ref} onChange={(v) => setRef(v.slice(0, 31))} />
                {(() => {
                  const mine = b && !isZeroHandle(b.handle) ? revealed[b.handle.toLowerCase()] : b ? 0n : undefined;
                  if (mine === undefined) return <p className="text-xs text-silt">Tip: reveal your balance above to check this run is covered.</p>;
                  if (mine >= total) return <p className="text-xs text-sea-green">Covered: your private balance is {fromUnits(mine)} cAUSD.</p>;
                  return (
                    <p role="alert" className="rounded-xl border border-lantern/30 bg-lantern-soft px-3 py-2 text-sm text-lantern">
                      Your private balance ({fromUnits(mine)} cAUSD) is below this run ({fromUnits(total)}). A salary that does not fit is paid as 0, silently: the contract never reveals a shortfall. Wrap more first.
                    </p>
                  );
                })()}
              </div>
            </Card>

            <Card title="3 · Pay" sub="Either sign it yourself now, or let a policy-fenced payroll operator run it on schedule while you are offline.">
              <div className="rounded-2xl border border-kelp p-4">
                <p className="text-sm font-semibold">Pay now from your wallet</p>
                <p className="mt-1 text-sm text-tide">runPayroll: one transaction, {rows.length} encrypted salaries{w.sponsored ? ", gas sponsored" : ""}.</p>
                <button
                  disabled={!valid || pa.busy || oa.busy}
                  onClick={() => {
                    setPayTx(null);
                    void pa.run(async (step) => {
                      const tx = await runPayrollDirect(env, w, parsed(), ref, step);
                      setPayTx({ tx, label: `Payroll for ${rows.length} paid` });
                      await refresh();
                    });
                  }}
                  className="mt-3 rounded-xl bg-biolum px-5 py-2.5 font-semibold text-abyss hover:brightness-110 disabled:opacity-50"
                >
                  {pa.busy ? "Paying…" : `Run payroll · ${fromUnits(total)} AUSD`}
                </button>
                <div className="mt-2">
                  <Status step={pa.step} error={pa.error} />
                </div>
              </div>

              <div className="rounded-2xl border border-biolum/25 bg-biolum-soft/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">Automate with a payroll operator</p>
                  {op && <span className="rounded-full bg-abyss px-2.5 py-0.5 text-xs text-tide">{op.kind === "privy-server-wallet" ? "Privy server wallet" : "fork stand-in for the Privy server wallet"}</span>}
                </div>
                {!op ? (
                  <p className="mt-2 text-sm text-reef">No operator configured. Create the Privy server wallet and policy with scripts/privy-setup.ts (app/PRIVY.md).</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-tide">
                      Operator <span className="font-mono text-xs text-foam">{short(op.address)}</span>{" "}
                      {authorized ? <span className="text-sea-green">authorized until {new Date(until! * 1000).toLocaleString()}</span> : <span className="text-silt">not authorized by you</span>}
                    </p>
                    <ul className="mt-3 grid gap-1 text-xs text-tide sm:grid-cols-2">
                      {describePolicy(env.token).map((l) => (
                        <li key={l} className="flex gap-1.5">
                          <span className="text-biolum" aria-hidden>
                            ▸
                          </span>
                          {l}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-silt">
                      {op.kind === "privy-server-wallet" ? `Privy policy ${op.policyId ?? "(id not set)"} is enforced in Privy's enclave before anything is signed.` : "On the fork without Privy credentials a dev key plays the operator; the same on-chain checks apply (setOperator, the employer's batch signature)."} Salaries are encrypted here for the operator&apos;s address and you sign the exact batch, so the server never sees an amount and cannot change one.
                    </p>
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {!authorized ? (
                        <button
                          disabled={oa.busy}
                          onClick={() =>
                            void oa.run(async (step) => {
                              step("Authorizing the operator on-chain for 30 days (setOperator)…");
                              const tx = await authorizeOperator(env, w, op.address, now + 30 * 86400);
                              setPayTx({ tx, label: "Operator authorized" });
                              await loadUntil();
                            })
                          }
                          className="rounded-xl bg-biolum px-4 py-2.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50"
                        >
                          Authorize operator · 30 days
                        </button>
                      ) : (
                        <>
                          <button disabled={!valid || oa.busy || pa.busy} onClick={() => void viaOperator(null)} className="rounded-xl bg-biolum px-4 py-2.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
                            Run via operator now
                          </button>
                          <label className="flex items-center gap-2 text-sm text-tide">
                            or in
                            <input aria-label="Minutes from now" value={delay} inputMode="numeric" onChange={(e) => setDelay(e.target.value.replace(/\D/g, "").slice(0, 4))} className="w-14 rounded-lg border border-kelp bg-abyss px-2 py-2 text-center tabular" />
                            min
                          </label>
                          <button disabled={!valid || oa.busy || pa.busy || !Number(delay)} onClick={() => void viaOperator(Date.now() + Number(delay) * 60_000)} className="rounded-xl border border-kelp-strong px-4 py-2.5 text-sm font-semibold hover:bg-trench-2 disabled:opacity-50">
                            Schedule
                          </button>
                          <button
                            disabled={oa.busy}
                            onClick={() =>
                              void oa.run(async () => {
                                const tx = await authorizeOperator(env, w, op.address, 0);
                                setPayTx({ tx, label: "Operator revoked" });
                                await loadUntil();
                              })
                            }
                            className="rounded-xl px-3 py-2.5 text-sm text-silt hover:text-reef"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                    <div className="mt-2">
                      <Status step={oa.step} error={oa.error} />
                    </div>
                    {job && (
                      <p className="mt-2 text-sm" aria-live="polite">
                        Batch <span className="font-mono text-xs">{job.id}</span>{" "}
                        {job.status === "scheduled" ? (
                          <span className="text-biolum">scheduled for {new Date(job.runAt).toLocaleTimeString()}. You can close this tab.</span>
                        ) : job.status === "running" ? (
                          <span className="text-biolum">running…</span>
                        ) : job.status === "done" ? (
                          <span className="text-sea-green">ran on schedule.</span>
                        ) : (
                          <span className="text-reef">failed: {job.error}</span>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
              {payTx && <Settlement tx={payTx.tx} client={env.client} network={env.network} label={payTx.label} />}
            </Card>
          </div>
          <div className="min-w-0 space-y-6">
            <ActivityCard env={env} wallet={w} revealed={revealed} setRevealed={setRevealed} refreshKey={tick} title="Payroll ledger" />
            <Heartbeat rows={5} compact />
          </div>
        </div>
      )}
    </div>
  );
}
