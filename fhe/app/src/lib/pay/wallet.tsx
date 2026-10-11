"use client";
// Kakushi Confidential wallet layer. One interface, two backends:
//   - Privy (NEXT_PUBLIC_PRIVY_APP_ID set): email/passkey login, an embedded wallet on Monad testnet,
//     transactions sent with Privy native gas sponsorship (EIP-7702 + paymaster), EIP-712 signing.
//   - Local fork (no Privy credentials): Foundry dev accounts or a fresh in-browser guest key,
//     LOCAL ANVIL ONLY, signed here and broadcast with eth_sendRawTransactionSync.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Hex, PublicClient, TransactionReceipt } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sendRawSync } from "@kakushi/fhe-sdk/monad";
import { useRt } from "@/lib/runtime";
import { MONAD_TESTNET_ID, type TypedDataLike } from "./core";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;

export interface TxRequest {
  to: Hex;
  data: Hex;
  /** explicit gas limit (estimate x 1.3): Monad bills the limit */
  gas: bigint;
}

export type Via = "privy-sponsored" | "privy-signed" | "local-key" | "local-sponsor" | "privy-server-wallet" | "privy-server-wallet-sponsored" | "local-dev-key";

export interface SentTx {
  hash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  receipt: TransactionReceipt;
  /** Date.now() when the user's action was submitted */
  submittedAt: number;
  /** submit -> receipt, ms */
  receiptMs: number;
  via: Via;
  /** true when the receipt came back from eth_sendRawTransactionSync in the same round trip */
  sync: boolean;
}

export interface PayWallet {
  kind: "privy" | "local";
  address: Hex;
  label: string;
  /** whether send() is gas-sponsored for this wallet */
  sponsored: boolean;
  send(tx: TxRequest): Promise<SentTx>;
  signTypedData(td: TypedDataLike): Promise<Hex>;
}

export interface PrivyState {
  ready: boolean;
  authenticated: boolean;
  wallet: PayWallet | null;
  login: () => void;
  logout: () => Promise<void>;
  error?: string;
}

interface PayCtx {
  mode: "privy" | "local";
  ready: boolean;
  wallet: PayWallet | null;
  login: () => void;
  logout: () => void;
  local: {
    accounts: { label: string; key: Hex }[];
    select: (key: Hex, label: string) => void;
    guest: () => void;
  };
}

const Ctx = createContext<PayCtx | null>(null);

/** Broadcast a signed tx (eth_sendRawTransactionSync where supported) and return the full receipt. */
export async function broadcast(client: PublicClient, serialized: Hex, submittedAt: number, via: Via): Promise<SentTx> {
  const r = await sendRawSync(client, serialized);
  const receipt = await client.getTransactionReceipt({ hash: r.hash });
  const out: SentTx = { hash: r.hash, blockNumber: r.blockNumber, blockHash: r.blockHash, receipt, submittedAt, receiptMs: Date.now() - submittedAt, via, sync: r.sync };
  if (receipt.status !== "success") throw Object.assign(new Error(`transaction ${r.hash.slice(0, 10)}… reverted`), { sent: out });
  return out;
}

/** Fork only: make sure a fresh account can pay for gas (the app's /api/faucet sets its MON balance). */
export async function ensureForkGas(client: PublicClient, address: Hex) {
  const bal = await client.getBalance({ address });
  if (bal >= 10n ** 16n) return;
  const r = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, mon: true }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "fork faucet failed");
}

function localWallet(client: PublicClient, key: Hex, label: string, guest: boolean): PayWallet {
  const acct = privateKeyToAccount(key);
  return {
    kind: "local",
    address: acct.address,
    label,
    sponsored: false,
    async send(tx) {
      const submittedAt = Date.now();
      if (guest) await ensureForkGas(client, acct.address);
      const [nonce, fees] = await Promise.all([client.getTransactionCount({ address: acct.address, blockTag: "pending" }), client.estimateFeesPerGas()]);
      const serialized = await acct.signTransaction({
        chainId: MONAD_TESTNET_ID,
        type: "eip1559",
        to: tx.to,
        data: tx.data,
        gas: tx.gas,
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      return broadcast(client, serialized, submittedAt, "local-key");
    },
    async signTypedData(td) {
      return acct.signTypedData(td as never);
    },
  };
}

// The literal env check lets the bundler drop the Privy chunk entirely when no app ID is set.
const PrivyBridge = process.env.NEXT_PUBLIC_PRIVY_APP_ID ? lazy(() => import("./privy-bridge")) : null;
const STORE = "kakushi-pay-local";
const GUEST = "kakushi-pay-guest";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: selection just isn't remembered */
    }
  },
};

export function PayWalletProvider({ children }: { children: ReactNode }) {
  const rt = useRt();
  const [privy, setPrivy] = useState<PrivyState | null>(null);
  const [local, setLocal] = useState<{ key: Hex; label: string; guest: boolean } | null>(null);
  const mode: "privy" | "local" = PRIVY_APP_ID ? "privy" : "local";

  // restore the local-fork account across pages
  useEffect(() => {
    if (mode !== "local") return;
    const s = store.get(STORE);
    if (s) {
      try {
        setLocal(JSON.parse(s));
      } catch {
        store.set(STORE, null);
      }
    }
  }, [mode]);

  const select = useCallback((key: Hex, label: string) => {
    const v = { key, label, guest: false };
    setLocal(v);
    store.set(STORE, JSON.stringify(v));
  }, []);
  const guest = useCallback(() => {
    let key = store.get(GUEST) as Hex | null;
    if (!key) {
      key = generatePrivateKey();
      store.set(GUEST, key);
    }
    const v = { key, label: "New guest (fork)", guest: true };
    setLocal(v);
    store.set(STORE, JSON.stringify(v));
  }, []);

  const localPw = useMemo(() => (rt.client && local && rt.cfg?.network === "local" ? localWallet(rt.client, local.key, local.label, local.guest) : null), [rt.client, rt.cfg?.network, local]);

  const value: PayCtx = {
    mode,
    ready: mode === "privy" ? Boolean(privy?.ready) : rt.cfg !== null,
    wallet: mode === "privy" ? (privy?.wallet ?? null) : localPw,
    login: () => privy?.login(),
    logout: () => {
      if (mode === "privy") void privy?.logout();
      else {
        setLocal(null);
        store.set(STORE, null);
      }
    },
    local: { accounts: rt.cfg?.localKeys ?? [], select, guest },
  };

  return (
    <Ctx.Provider value={value}>
      {PrivyBridge && mode === "privy" && rt.client && rt.cfg && (
        <Suspense fallback={null}>
          <PrivyBridge appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID} client={rt.client} network={rt.cfg.network} onState={setPrivy} />
        </Suspense>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function usePay(): PayCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePay outside PayWalletProvider");
  return v;
}
