"use client";

import { useCallback, useRef, useState } from "react";
import { maxUint256, zeroAddress, type Hex } from "viem";
import { CHAINS, chainById, ETH_USD_FEED_MONAD_TESTNET, type ChainKey } from "@kakushi/config";
import { ebcAbi, erc20Abi, mdcAbi } from "@kakushi/sdk";
import { Amount, Button, Card, ChainDot, Notice, Pill, Spinner, Stat, PageHeader } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { usePoll } from "@/lib/usePoll";
import { ROUTES } from "@/lib/routes";
import { marginAmount, routeParameters } from "@/lib/maker-form";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

export default function MakerConsole() {
  const { k } = useRuntime();
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [amount, setAmount] = useState("100");
  const [form, setForm] = useState({ route: ROUTES[0]!.id, withholding: "0.05", bps: "10", min: "1", max: "500" });
  const usdc = CHAINS.monadTestnet.usdc.address;
  const load = useCallback(async () => {
    const me = w.address!;
    const [pairs, m, pending, bal, makers] = await Promise.all([
      k!.pairs(me),
      k!.margin(me, usdc),
      k!.hub.readContract({ address: k!.d.hub.mdc, abi: mdcAbi, functionName: "pendingWithdraw", args: [me, usdc] }) as Promise<readonly [bigint, bigint]>,
      k!.hub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] }) as Promise<bigint>,
      k!.makers(),
    ]);
    return { pairs, m, pending: { amount: pending[0], unlockAt: pending[1] }, bal, isMaker: makers.some((x) => x.toLowerCase() === me.toLowerCase()) };
  }, [k, w.address, usdc]);
  const { data, error } = usePoll(k && w.address ? load : null, 4000, [k, w.address]);

  async function run(label: string, fn: () => Promise<Hex>) {
    if (running.current || !k) return;
    running.current = true;
    setBusy(label);
    setMsg(null);
    try {
      const h = await fn();
      requireSuccessfulReceipt(await k!.hub.waitForTransactionReceipt({ hash: h }), label);
      setMsg({ tone: "ok", text: `${label}: confirmed` });
    } catch (e) {
      setMsg({ tone: "bad", text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]! });
    } finally {
      running.current = false;
      setBusy(null);
    }
  }
  const hubWc = () => w.walletClient("monadTestnet");

  if (!w.address) return <div><PageHeader title="Maker console" subtitle="Post margin, register routes and fees, and manage withdrawals." /><Notice>Connect the Maker's wallet.</Notice></div>;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const r = ROUTES.find((x) => x.id === form.route)!;
  const native = r.asset === "ETH";
  const dec = native ? 18 : 6;
  return (
    <div>
      <PageHeader title="Maker console" subtitle="Margin lives on the Monad hub. Withdrawals are timelocked past every fill, attestation and dispute window, and never go below the required margin." />
      {error && <Notice tone="warn">{error}</Notice>}
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {!data ? (
        <Card className="flex items-center gap-3"><Spinner /> Reading the hub…</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <div className="font-medium">Margin (Monad USDC)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Posted" value={<Amount value={data.m.margin} decimals={6} max={2} />} />
              <Stat label="Required" value={data.m.required === null ? "stale price" : <Amount value={data.m.required} decimals={6} max={2} />} sub="1.1 × largest limit" />
              <Stat label="Wallet" value={<Amount value={data.bal} decimals={6} max={2} />} />
            </div>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Margin amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 rounded-full border border-line bg-s2 px-4 text-sm outline-none" />
              <Button loading={busy === "Deposit"} onClick={() => run("Deposit", async () => {
                const v = marginAmount(amount);
                const wc = await hubWc();
                const allowance = (await k!.hub.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [w.address!, k!.d.hub.mdc] })) as bigint;
                if (allowance < v) requireSuccessfulReceipt(await k!.hub.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: wc.chain, account: wc.account!, address: usdc, abi: erc20Abi, functionName: "approve", args: [k!.d.hub.mdc, maxUint256] }) }), "Margin approval");
                return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "depositMargin", args: [usdc, v] });
              })}>Deposit</Button>
              <Button variant="ghost" loading={busy === "Request withdrawal"} onClick={() => run("Request withdrawal", async () => {
                const v = marginAmount(amount);
                const wc = await hubWc();
                return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "requestWithdraw", args: [usdc, v] });
              })}>Request withdrawal</Button>
            </div>
            {data.pending.amount > 0n && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-s2 p-3 text-sm">
                <span>Pending withdrawal of <Amount value={data.pending.amount} decimals={6} symbol="USDC" /> {data.pending.unlockAt > now ? `· unlocks in ${data.pending.unlockAt - now} s` : "· unlocked"}</span>
                <Button className="h-9 px-4 text-sm" disabled={data.pending.unlockAt > now || data.m.openDisputes > 0n} loading={busy === "Withdraw"} onClick={() => run("Withdraw", async () => {
                  const wc = await hubWc();
                  return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "executeWithdraw", args: [usdc] });
                })}>Withdraw</Button>
              </div>
            )}
            {data.m.openDisputes > 0n && <Notice tone="warn">{data.m.openDisputes.toString()} open dispute(s): withdrawals are blocked until they close.</Notice>}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between"><div className="font-medium">Your routes</div>{data.isMaker ? <Pill tone="ok">registered Maker</Pill> : <Pill>not a Maker yet</Pill>}</div>
            {data.pairs.length === 0 && <div className="text-sm text-muted">No routes yet. Register one below.</div>}
            {data.pairs.map((p) => {
              const nat = p.srcToken === zeroAddress;
              return (
                <div key={p.pairId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-s2 p-3 text-sm">
                  <span className="inline-flex items-center gap-1.5"><ChainDot chainId={p.srcChainId} /> {chainById(p.srcChainId).shortName} → <ChainDot chainId={p.dstChainId} /> {chainById(p.dstChainId).shortName} <span className="text-dim">{nat ? "ETH" : "USDC"}</span></span>
                  <span className="text-muted tabular">{Number(p.tradingFeeBps) / 100}% + <Amount value={p.withholdingFee} decimals={nat ? 18 : 6} /></span>
                  <Button variant={p.active ? "danger" : "soft"} className="h-8 px-3 text-xs" loading={busy === p.pairId} onClick={() => run(p.pairId, async () => {
                    const wc = await hubWc();
                    return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.ebc, abi: ebcAbi, functionName: "setActive", args: [p.pairId, !p.active] });
                  })}>{p.active ? "Deactivate" : "Activate"}</Button>
                </div>
              );
            })}
            <div className="border-t border-line pt-3">
              <div className="mb-2 text-sm font-medium">Register a route</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <select aria-label="Route" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} className="col-span-2 rounded-xl border border-line bg-s2 px-3 py-2">
                  {ROUTES.map((x) => <option key={x.id} value={x.id}>{CHAINS[x.src].shortName} → {CHAINS[x.dst].shortName} · {x.asset}</option>)}
                </select>
                {(["withholding", "bps", "min", "max"] as const).map((f) => (
                  <label key={f} className="flex min-w-0 flex-col gap-1 text-xs text-muted">
                    {f === "bps" ? "Trading fee (bps)" : f === "withholding" ? `Withholding (${native ? "ETH" : "USDC"})` : `${f === "min" ? "Min" : "Max"} (${native ? "ETH" : "USDC"})`}
                    <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className="w-full min-w-0 rounded-xl border border-line bg-s2 px-3 py-2 text-sm text-text outline-none" />
                  </label>
                ))}
              </div>
              <Button className="mt-3 w-full" loading={busy === "Register route"} onClick={() => run("Register route", async () => {
                const parameters = routeParameters(form, dec);
                const wc = await hubWc();
                const src = CHAINS[r.src as ChainKey];
                const dst = CHAINS[r.dst as ChainKey];
                return wc.writeContract({
                  chain: wc.chain, account: wc.account!, address: k!.d.hub.ebc, abi: ebcAbi, functionName: "registerPair",
                  args: [
                    { maker: w.address!, srcChainId: BigInt(src.chainId), srcToken: native ? zeroAddress : src.usdc.address, dstChainId: BigInt(dst.chainId), dstToken: native ? zeroAddress : dst.usdc.address, identCode: dst.identCode },
                    { effectiveFrom: 0n, ...parameters },
                    { marginToken: usdc, priceFeed: native ? ETH_USD_FEED_MONAD_TESTNET : zeroAddress, srcDecimals: dec, set: true },
                  ],
                });
              })}>Register on the EBC</Button>
              <p className="mt-2 text-xs text-dim">Fee and limit changes take effect after the EBC's parameter delay, so open quotes stay honest. Run a Maker node (packages/maker) to fill.</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
