"use client";

import { useCallback, useRef, useState } from "react";
import { maxUint256, zeroAddress, type Hex } from "viem";
import { CHAINS, ETH_USD_FEED_MONAD_TESTNET, type ChainKey } from "@kakushi/config";
import { ebcAbi, erc20Abi, mdcAbi } from "@kakushi/sdk";
import { PanelCard, PrimaryButton, SecondaryButton } from "@kakushi/ui";
import { ArrowDownToLine, ArrowUpFromLine, Plus } from "lucide-react";
import { Amount, Loading, Notice, PageHead, Pill, Route, Stat, fieldCls, readError } from "@/components/kit";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { usePoll } from "@/lib/usePoll";
import { routesFor } from "@/lib/routes";
import { marginAmount, routeParameters } from "@/lib/maker-form";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

export default function MakerConsole() {
  const { k, cfg } = useRuntime();
  const routes = routesFor(cfg?.deployments);
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [amount, setAmount] = useState("100");
  const [form, setForm] = useState({ route: routes[0]!.id, withholding: "0.05", bps: "10", min: "1", max: "500" });
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

  if (!w.address) return <div><PageHead title="Maker console" sub="Post margin, register routes and fees, and manage withdrawals." /><Notice title="Connect the Maker's wallet">Use the Connect button at the top right. The console reads margin and routes for the connected address.</Notice></div>;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const r = routes.find((x) => x.id === form.route) ?? routes[0]!;
  const native = r.asset === "ETH";
  const dec = native ? 18 : 6;
  return (
    <div>
      <PageHead
        title="Maker console"
        sub="Margin lives on the Monad hub. Withdrawals are timelocked past every fill, attestation and dispute window, and never go below the required margin."
        right={data ? (data.isMaker ? <Pill tone="ok">Registered Maker</Pill> : <Pill>Not a Maker yet</Pill>) : undefined}
      />
      {!k && <Notice tone="warn" title="The hub is not reachable">The console needs the Kakushi contracts on Monad. They aren't deployed for this network yet.</Notice>}
      {error && <Notice tone="warn" title="The hub can't be read">{readError(error)}</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!data ? (
        k ? <Loading>Reading the hub…</Loading> : null
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelCard title="Margin" subtitle="USDC on Monad">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Posted" value={<Amount value={data.m.margin} decimals={6} max={2} />} />
              <Stat label="Required" value={data.m.required === null ? "stale price" : <Amount value={data.m.required} decimals={6} max={2} />} sub="1.1 × largest limit" />
              <Stat label="In wallet" value={<Amount value={data.bal} decimals={6} max={2} />} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <input aria-label="Margin amount (USDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldCls} w-36`} />
              <PrimaryButton size="lg" icon={<ArrowDownToLine />} loading={busy === "Deposit"} onClick={() => run("Deposit", async () => {
                const v = marginAmount(amount);
                const wc = await hubWc();
                const allowance = (await k!.hub.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [w.address!, k!.d.hub.mdc] })) as bigint;
                if (allowance < v) requireSuccessfulReceipt(await k!.hub.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: wc.chain, account: wc.account!, address: usdc, abi: erc20Abi, functionName: "approve", args: [k!.d.hub.mdc, maxUint256] }) }), "Margin approval");
                return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "depositMargin", args: [usdc, v] });
              })}>Deposit</PrimaryButton>
              <SecondaryButton size="lg" icon={<ArrowUpFromLine />} loading={busy === "Request withdrawal"} onClick={() => run("Request withdrawal", async () => {
                const v = marginAmount(amount);
                const wc = await hubWc();
                return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "requestWithdraw", args: [usdc, v] });
              })}>Request withdrawal</SecondaryButton>
            </div>
            {data.pending.amount > 0n && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-ui-canvas px-4 py-3 text-[14px]">
                <span>Pending withdrawal of <Amount value={data.pending.amount} decimals={6} symbol="USDC" /> {data.pending.unlockAt > now ? `· unlocks in ${data.pending.unlockAt - now} s` : "· unlocked"}</span>
                <PrimaryButton size="sm" disabled={data.pending.unlockAt > now || data.m.openDisputes > 0n} loading={busy === "Withdraw"} onClick={() => run("Withdraw", async () => {
                  const wc = await hubWc();
                  return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.mdc, abi: mdcAbi, functionName: "executeWithdraw", args: [usdc] });
                })}>Withdraw</PrimaryButton>
              </div>
            )}
            {data.m.openDisputes > 0n && <Notice tone="warn" className="mt-4 mb-0">{data.m.openDisputes.toString()} open dispute(s): withdrawals are blocked until they close.</Notice>}
          </PanelCard>

          <PanelCard title="Your routes" subtitle="Registered in the EBC">
            {data.pairs.length === 0 && <p className="text-[15px] text-ui-muted">No routes yet. Register one below.</p>}
            <div className="grid gap-1.5">
              {data.pairs.map((p) => {
                const nat = p.srcToken === zeroAddress;
                return (
                  <div key={p.pairId} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-ui-canvas px-4 py-3 text-[14px]">
                    <span className="inline-flex items-center gap-2"><Route src={p.srcChainId} dst={p.dstChainId} size={18} /> <span className="text-ui-muted">{nat ? "ETH" : "USDC"}</span></span>
                    <span className="ui-figure text-ui-muted">{Number(p.tradingFeeBps) / 100}% + <Amount value={p.withholdingFee} decimals={nat ? 18 : 6} /></span>
                    <SecondaryButton size="sm" loading={busy === p.pairId} onClick={() => run(p.pairId, async () => {
                      const wc = await hubWc();
                      return wc.writeContract({ chain: wc.chain, account: wc.account!, address: k!.d.hub.ebc, abi: ebcAbi, functionName: "setActive", args: [p.pairId, !p.active] });
                    })}>{p.active ? "Deactivate" : "Activate"}</SecondaryButton>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 border-t border-ui-hairline pt-5">
              <h3 className="mb-3 text-[16px] font-medium">Register a route</h3>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="Route" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} className={`${fieldCls} col-span-2`}>
                  {routes.map((x) => <option key={x.id} value={x.id}>{CHAINS[x.src].shortName} → {CHAINS[x.dst].shortName} · {x.asset}</option>)}
                </select>
                {(["withholding", "bps", "min", "max"] as const).map((f) => (
                  <label key={f} className="grid min-w-0 gap-1.5 text-[13px] text-ui-muted">
                    <span className="px-1">{f === "bps" ? "Trading fee (bps)" : f === "withholding" ? `Withholding (${native ? "ETH" : "USDC"})` : `${f === "min" ? "Min" : "Max"} (${native ? "ETH" : "USDC"})`}</span>
                    <input inputMode="decimal" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className={fieldCls} />
                  </label>
                ))}
              </div>
              <PrimaryButton size="lg" block icon={<Plus />} className="mt-4" loading={busy === "Register route"} onClick={() => run("Register route", async () => {
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
              })}>Register on the EBC</PrimaryButton>
              <p className="mt-3 text-[13px] text-ui-muted">Fee and limit changes take effect after the EBC&rsquo;s parameter delay, so open quotes stay honest. Run a Maker node (packages/maker) to fill.</p>
            </div>
          </PanelCard>
        </div>
      )}
    </div>
  );
}
