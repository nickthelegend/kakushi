"use client";

// The account layer. Privy (when NEXT_PUBLIC_PRIVY_APP_ID is set) is primary: external wallets
// plus an embedded wallet, and Privy's native gas sponsorship on Monad testnet for disputes.
// Without Privy: an injected EIP-1193 wallet. On the LOCAL network only, a labelled
// "local fork account" signs with anvil's public dev keys so the demo runs without a wallet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, http, type Hex, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, type ChainKey } from "@kakushi/config";
import { viemChain } from "@kakushi/sdk";
import { useRuntime } from "./runtime";

export type WalletKind = "local-dev" | "injected" | "privy";

export interface SponsoredTx {
  to: Hex;
  data: Hex;
  value?: bigint;
}

interface WalletState {
  address: Hex | null;
  kind: WalletKind | null;
  label: string | null;
  connectLocal: (key: Hex, label: string) => void;
  connectInjected: () => Promise<void>;
  disconnect: () => void;
  walletClient: (chain: ChainKey) => Promise<WalletClient>;
  /** Privy native gas sponsorship (Monad testnet). null when Privy isn't configured. */
  sendSponsored: ((tx: SponsoredTx) => Promise<Hex>) | null;
  privy: { configured: boolean; login?: () => void; ready?: boolean };
  setPrivyBridge: (b: PrivyBridgeValue | null) => void;
}

export interface PrivyBridgeValue {
  address: Hex | null;
  login: () => void;
  logout: () => void;
  ready: boolean;
  provider: () => Promise<{ request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }>;
  switchChain: (chainId: number) => Promise<void>;
  sendSponsored: (tx: SponsoredTx) => Promise<Hex>;
}

const Ctx = createContext<WalletState | null>(null);
const STORE = "kakushi.wallet";

declare global {
  interface Window {
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { cfg, rpc } = useRuntime();
  const [address, setAddress] = useState<Hex | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [devKey, setDevKey] = useState<Hex | null>(null);
  const [privy, setPrivyBridge] = useState<PrivyBridgeValue | null>(null);

  // restore a local-dev selection (local network only)
  useEffect(() => {
    if (!cfg || cfg.network !== "local") return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { kind: WalletKind; key?: Hex; label?: string } | null;
      if (saved?.kind === "local-dev" && saved.key && cfg.localDevKeys.some((d) => d.key === saved.key)) {
        setDevKey(saved.key);
        setAddress(privateKeyToAccount(saved.key).address);
        setKind("local-dev");
        setLabel(saved.label ?? "Local fork account");
      }
    } catch {}
  }, [cfg]);

  // Privy connection drives the state when present
  useEffect(() => {
    if (privy?.address) {
      setAddress(privy.address);
      setKind("privy");
      setLabel("Privy wallet");
    } else if (kind === "privy") {
      setAddress(null);
      setKind(null);
      setLabel(null);
    }
  }, [privy?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectLocal = useCallback((key: Hex, l: string) => {
    if (cfg?.network !== "local" || !cfg.localDevKeys.some((d) => d.key === key)) throw new Error("Local fork account is unavailable on this network");
    setDevKey(key);
    setAddress(privateKeyToAccount(key).address);
    setKind("local-dev");
    setLabel(l);
    try {
      localStorage.setItem(STORE, JSON.stringify({ kind: "local-dev", key, label: l }));
    } catch {}
  }, [cfg]);

  const connectInjected = useCallback(async () => {
    if (!window.ethereum) throw new Error("No browser wallet found");
    const [a] = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Hex[];
    if (!a) throw new Error("wallet returned no account");
    setAddress(a);
    setKind("injected");
    setLabel("Browser wallet");
  }, []);

  const disconnect = useCallback(() => {
    if (kind === "privy") privy?.logout();
    setAddress(null);
    setKind(null);
    setLabel(null);
    setDevKey(null);
    try {
      localStorage.removeItem(STORE);
    } catch {}
  }, [kind, privy]);

  const walletClient = useCallback(
    async (key: ChainKey): Promise<WalletClient> => {
      const c = CHAINS[key];
      if (!cfg) throw new Error("Wait for network configuration");
      const network = cfg.network;
      if (kind === "local-dev" && devKey) {
        if (network !== "local" || !cfg.localDevKeys.some((d) => d.key === devKey)) throw new Error("Local fork accounts cannot sign on testnet");
        return createWalletClient({ account: privateKeyToAccount(devKey), chain: viemChain(c, network, rpc[key]), transport: http(rpc[key]) });
      }
      if (network === "local") throw new Error("Use a labelled local fork account for local transactions");
      if (kind === "privy" && privy) {
        await privy.switchChain(c.chainId);
        const p = await privy.provider();
        return createWalletClient({ account: privy.address!, chain: viemChain(c, network, rpc[key]), transport: custom(p) });
      }
      if (kind === "injected" && window.ethereum) {
        const hex = `0x${c.chainId.toString(16)}`;
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
        } catch (e) {
          if ((e as { code?: number }).code !== 4902) throw e;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: hex, chainName: c.name, nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 }, rpcUrls: [c.publicRpc], blockExplorerUrls: [c.explorer] }],
          });
        }
        return createWalletClient({ account: address!, chain: viemChain(c, network, rpc[key]), transport: custom(window.ethereum) });
      }
      throw new Error("Connect a wallet first");
    },
    [kind, devKey, privy, address, cfg, rpc],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      kind,
      label,
      connectLocal,
      connectInjected,
      disconnect,
      walletClient,
      sendSponsored: cfg?.network === "testnet" && kind === "privy" && privy ? privy.sendSponsored : null,
      privy: { configured: Boolean(cfg?.privyAppId), login: privy?.login, ready: privy?.ready },
      setPrivyBridge,
    }),
    [address, kind, label, connectLocal, connectInjected, disconnect, walletClient, privy, cfg],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
