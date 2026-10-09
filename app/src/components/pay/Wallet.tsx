"use client";
// Balance and activity panels shared by the employee view and the employer console.
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { usePay, type PayWallet } from "@/lib/pay/wallet";
import { activity, balances, reveal, type Activity, type PayEnv } from "@/lib/pay/flows";
import { bytes32ToRef, fromUnits, isZeroHandle, short } from "@/lib/pay/core";
import { Cipher, Revealed } from "@/components/ui";
import { Card, Status, useAction } from "./PayKit";

export function useBalances(env: PayEnv | null, wallet: PayWallet | null) {
  const [b, setB] = useState<{ ausd: bigint; handle: Hex } | null>(null);
  const load = useCallback(async () => {
    if (!env || !wallet) return setB(null);
    setB(await balances(env, wallet.address));
  }, [env, wallet]);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  return { b, reload: load };
}

export function BalanceCard({ env, wallet, b, reload, revealed, setRevealed }: { env: PayEnv; wallet: PayWallet; b: { ausd: bigint; handle: Hex } | null; reload: () => Promise<void>; revealed: Record<string, bigint>; setRevealed: (r: Record<string, bigint>) => void }) {
  const a = useAction();
  const pay = usePay();
  const mine = b && !isZeroHandle(b.handle) ? revealed[b.handle.toLowerCase()] : undefined;
  return (
    <Card
      title="Balances"
      sub="Your public AUSD is visible to anyone. Your cAUSD balance is a ciphertext: only your signature opens it, and only in this tab."
      aside={
        <button onClick={() => void reload()} className="rounded-lg px-2 py-1 text-xs text-tide hover:bg-trench-2 hover:text-foam" aria-label="Refresh balances">
          Refresh
        </button>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-kelp bg-abyss/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-silt">Public · Agora AUSD</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular">{b ? fromUnits(b.ausd) : "…"}</dd>
        </div>
        <div className="rounded-2xl border border-biolum/25 bg-abyss/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-silt">Private · cAUSD</dt>
          <dd className="mt-1 min-h-9">
            {!b ? (
              "…"
            ) : isZeroHandle(b.handle) ? (
              <span className="font-display text-2xl font-bold text-silt">0.00</span>
            ) : mine !== undefined ? (
              <span className="font-display text-2xl font-bold">
                <Revealed>{fromUnits(mine)}</Revealed>
              </span>
            ) : (
              <Cipher handle={b.handle} />
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={a.busy || !b || isZeroHandle(b.handle)}
          onClick={() =>
            a.run(async (step) => {
              step("Sign to read your balance (EIP-712)…");
              await reload();
              const fresh = await balances(env, wallet.address);
              const r = await reveal(env, wallet, [fresh.handle]);
              setRevealed({ ...revealed, ...r });
            })
          }
          className="rounded-xl bg-lantern px-4 py-2.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50"
        >
          {a.busy ? "Revealing…" : "Reveal my balance"}
        </button>
        {env.network === "local" && pay.wallet && b && b.ausd === 0n && (
          <button
            disabled={a.busy}
            onClick={() =>
              a.run(async (step) => {
                step("Asking Agora's faucet (as forked) for 10,000 test AUSD…");
                const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address, mon: true, ausd: true }) });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error);
                await reload();
              })
            }
            className="rounded-xl border border-kelp-strong px-4 py-2.5 text-sm font-semibold hover:bg-trench-2"
          >
            Get test AUSD (fork)
          </button>
        )}
      </div>
      <Status step={a.step} error={a.error} />
    </Card>
  );
}

const KIND: Record<Activity["kind"], string> = {
  received: "Received",
  sent: "Sent",
  wrapped: "Wrapped",
  "cash-out": "Cashed out",
  "link-created": "Pay link created",
  "link-claimed": "Pay link claimed",
  "payroll-out": "Payroll paid",
  "payroll-in": "Salary",
  "request-in": "Request payment",
  "request-out": "Request payment",
};

export function ActivityCard({ env, wallet, revealed, setRevealed, refreshKey, title = "Activity" }: { env: PayEnv; wallet: PayWallet; revealed: Record<string, bigint>; setRevealed: (r: Record<string, bigint>) => void; refreshKey: number; title?: string }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = useAction();
  useEffect(() => {
    let live = true;
    activity(env, wallet.address)
      .then((x) => live && setItems(x))
      .catch((e) => live && setErr((e as Error).message.split("\n")[0]!));
    return () => {
      live = false;
    };
  }, [env, wallet.address, refreshKey]);
  // wraps and cash-outs are public amounts by design; everything else only the two parties can open
  const hidden = (items ?? []).filter((i) => i.kind !== "wrapped" && i.kind !== "cash-out" && revealed[i.handle.toLowerCase()] === undefined);
  return (
    <Card
      title={title}
      sub="From cAUSD events on-chain. Anyone can see that these transfers happened and between whom; the amounts are ciphertext handles that only the two parties can open."
      aside={
        <button
          disabled={a.busy || !hidden.length}
          onClick={() => a.run(async () => setRevealed({ ...revealed, ...(await reveal(env, wallet, hidden.slice(0, 40).map((h) => h.handle))) }))}
          className="rounded-xl bg-lantern px-3.5 py-2 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-40"
        >
          {a.busy ? "Revealing…" : "Reveal my amounts"}
        </button>
      }
    >
      <Status step={a.step} error={a.error ?? err} />
      {items === null ? (
        <p className="text-sm text-silt">Reading the chain…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-silt">Nothing yet. Payments to {short(wallet.address)} will show up here.</p>
      ) : (
        <ul className="-mr-2 max-h-[40rem] divide-y divide-kelp overflow-y-auto pr-2" aria-label={title}>
          {items.slice(0, 30).map((i) => {
            const v = i.publicAmount ?? revealed[i.handle.toLowerCase()];
            const ref = i.ref ? bytes32ToRef(i.ref) : "";
            const incoming = i.kind === "received" || i.kind === "payroll-in" || i.kind === "link-claimed" || i.kind === "wrapped" || i.kind === "request-in";
            return (
              <li key={`${i.tx}-${i.logIndex}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 py-2.5 text-sm">
                <span>
                  <span className="font-semibold">{KIND[i.kind]}</span>
                  {i.counterparty && <span className="text-tide"> {incoming ? "from" : "to"} <span className="font-mono text-xs">{short(i.counterparty)}</span></span>}
                  {ref && <span className="ml-1.5 rounded bg-trench-2 px-1.5 py-0.5 text-xs text-tide">{ref}</span>}
                </span>
                <span className="text-right">
                  {v === undefined ? (i.kind === "cash-out" ? <span className="text-xs text-silt">awaiting KMS</span> : <Cipher handle={i.handle} />) : i.publicAmount !== undefined ? <span className="tabular text-tide">{fromUnits(v)} AUSD</span> : <Revealed>{`${incoming ? "+" : "−"}${fromUnits(v)}`}</Revealed>}
                </span>
                <span className="col-span-2 font-mono text-[11px] text-silt">
                  block {i.block.toString()} · {i.tx.slice(0, 10)}…
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
