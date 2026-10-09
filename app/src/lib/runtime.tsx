"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, http, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FhishClient } from "@fhish/sdk";
import { browserEncryptor } from "./encrypt";

export interface Deployment {
  registry: Hex;
  acl: Hex;
  executor: Hex;
  inputVerifier: Hex;
  oracle: Hex;
  chainId: number;
}

interface Cfg {
  network: "local" | "testnet";
  chainId: number;
  deployment: Deployment | null;
  apps: { auction: Hex; cusdc: Hex; otc: Hex; usdc: Hex } | null;
  localKeys: { label: string; key: Hex }[];
}

interface Rt {
  cfg: Cfg | null;
  client: PublicClient | null;
  fhish: FhishClient | null;
  account: Hex | null;
  label: string | null;
  wallet: WalletClient | null;
  connectLocal: (key: Hex, label: string) => void;
  connectInjected: () => Promise<void>;
  disconnect: () => void;
}

const Ctx = createContext<Rt | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setCfg).catch(() => setCfg(null));
  }, []);
  const chain = useMemo(
    () => defineChain({ id: cfg?.chainId ?? 10143, name: cfg?.network === "local" ? "Monad testnet (local fork)" : "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["/api/rpc"] } } }),
    [cfg],
  );
  const client = useMemo(() => (typeof window === "undefined" ? null : (createPublicClient({ chain, transport: http(`${location.origin}/api/rpc`) }) as PublicClient)), [chain]);
  const fhish = useMemo(() => (typeof window === "undefined" ? null : new FhishClient({ gatewayUrl: `${location.origin}/api/gw`, chainId: cfg?.chainId ?? 10143, encryptor: browserEncryptor })), [cfg]);

  const value: Rt = {
    cfg,
    client,
    fhish,
    wallet,
    label,
    account: (wallet?.account?.address as Hex) ?? null,
    connectLocal: (key, l) => {
      setWallet(createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(`${location.origin}/api/rpc`) }));
      setLabel(l);
    },
    connectInjected: async () => {
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("No browser wallet found");
      const [a] = await eth.request({ method: "eth_requestAccounts" });
      setWallet(createWalletClient({ account: a, chain, transport: custom(eth) }));
      setLabel("Browser wallet");
    },
    disconnect: () => {
      setWallet(null);
      setLabel(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRt(): Rt {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRt outside RuntimeProvider");
  return v;
}
