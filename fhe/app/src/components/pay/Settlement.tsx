"use client";
// The settlement ladder shown after every payment: how settled is it, measured, not promised.
// Against Monad testnet it follows the block through monadNewHeads (Proposed -> Voted -> Finalized ->
// Verified). Against the local fork it uses the equivalent block tags (latest / safe / finalized).
import { useEffect, useState } from "react";
import { COMMIT_STATES, trackByTags, type CommitState } from "@kakushi/fhe-sdk/monad";
import type { PublicClient } from "viem";
import { acquireHeads, releaseHeads } from "@/lib/pay/heads";
import type { SentTx } from "@/lib/pay/wallet";

const VIA: Record<SentTx["via"], string> = {
  "privy-sponsored": "gas sponsored by Privy",
  "privy-signed": "signed by your Privy wallet",
  "local-key": "signed in this tab",
  "local-sponsor": "submitted by the fork's sponsor relayer",
  "privy-server-wallet": "submitted by the Privy server wallet (policy-checked)",
  "privy-server-wallet-sponsored": "submitted by the Privy server wallet, gas sponsored",
  "local-dev-key": "submitted by the payroll operator (fork stand-in for the Privy server wallet)",
};

const HINT: Record<CommitState, string> = {
  Proposed: "in a block the leader proposed",
  Voted: "a quorum of validators voted for it",
  Finalized: "final: it cannot be reverted",
  Verified: "the state root was verified",
};

export function Settlement({ tx, client, network, label }: { tx: SentTx; client: PublicClient; network: "local" | "testnet"; label?: string }) {
  const [at, setAt] = useState<Partial<Record<CommitState, number>>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setAt({});
    setErr(null);
    const mark = (s: CommitState) => live && setAt((a) => (a[s] === undefined ? { ...a, [s]: Date.now() - tx.submittedAt } : a));
    if (network === "testnet") {
      acquireHeads()
        .then((h) => h.track(tx.blockNumber, { hash: tx.blockHash, until: "Verified", onState: (s) => mark(s), timeoutMs: 30_000 }))
        .catch((e) => live && setErr((e as Error).message))
        .finally(() => releaseHeads());
    } else {
      trackByTags(client, tx.blockNumber, { until: "Finalized", pollMs: 50, onState: (s) => mark(s), timeoutMs: 30_000 }).catch((e) => live && setErr((e as Error).message));
    }
    return () => {
      live = false;
    };
  }, [tx, client, network]);

  const states = network === "testnet" ? COMMIT_STATES : COMMIT_STATES.slice(0, 3);
  const done = at.Finalized !== undefined;
  return (
    <div className="rounded-2xl border border-kelp bg-abyss/70 p-4" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">
          {label ?? "Settlement"} <span className={done ? "text-sea-green" : "text-biolum"}>{done ? "final" : "settling…"}</span>
        </p>
        <p className="font-mono text-xs text-silt">
          block {tx.blockNumber.toString()} · {tx.hash.slice(0, 10)}…
        </p>
      </div>
      <ol className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${states.length}, minmax(0, 1fr))` }}>
        {states.map((s, i) => {
          const t = at[s];
          const on = t !== undefined;
          return (
            <li key={s} className="relative">
              <div className={`h-1.5 rounded-full transition-colors duration-300 ${on ? (s === "Finalized" || s === "Verified" ? "bg-sea-green" : "bg-biolum") : "bg-kelp-strong"}`} />
              <p className={`mt-2 text-xs font-semibold ${on ? "text-foam" : "text-silt"}`}>
                <span className="font-mono text-[10px] text-silt">{String(i + 1).padStart(2, "0")} </span>
                {s}
              </p>
              <p className={`tabular text-sm ${on ? "text-biolum" : "text-silt"}`}>{on ? `${t} ms` : "…"}</p>
              <p className="hidden text-[11px] leading-snug text-silt sm:block">{HINT[s]}</p>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-silt">
        Receipt in <span className="tabular text-tide">{tx.receiptMs} ms</span>
        {tx.sync ? " via eth_sendRawTransactionSync (one round trip)" : ""} · {VIA[tx.via]}
        {network === "local" ? " · local fork: states from block tags; Verified exists on Monad itself (see the live heartbeat)" : ""}
      </p>
      {err && <p className="mt-1 text-xs text-reef">{err}</p>}
    </div>
  );
}
