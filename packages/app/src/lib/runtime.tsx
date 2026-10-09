"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAINS, type ChainKey } from "@kakushi/config";
import { Kakushi } from "@kakushi/sdk";

export interface MakerEntry {
  name: string;
  address: `0x${string}`;
  url: string;
}

export interface RuntimeConfig {
  network: "local" | "testnet";
  deployments: any;
  makers: MakerEntry[];
  services: { attester: string | null; watchtower: string | null; indexer: string | null; relayer: string | null };
  privyAppId: string | null;
  envioStatsEnabled: boolean;
  localDevKeys: { label: string; key: `0x${string}` }[];
  error?: string;
}

interface RuntimeState {
  cfg: RuntimeConfig | null;
  k: Kakushi | null;
  error: string | null;
  /** maker HTTP endpoints through the same-origin proxy */
  makerUrls: string[];
  rpc: Record<ChainKey, string>;
}

const Ctx = createContext<RuntimeState>({ cfg: null, k: null, error: null, makerUrls: [], rpc: {} as Record<ChainKey, string> });

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: RuntimeConfig) => {
        setCfg(c);
        if (c.error) setError(c.error);
      })
      .catch((e) => setError(`config unavailable: ${(e as Error).message}`));
  }, []);
  const value = useMemo<RuntimeState>(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const rpc = Object.fromEntries((Object.keys(CHAINS) as ChainKey[]).map((key) => [key, `${origin}/api/rpc/${CHAINS[key].chainId}`])) as Record<ChainKey, string>;
    if (!cfg || !cfg.deployments) return { cfg, k: null, error, makerUrls: [], rpc };
    const k = new Kakushi({ network: cfg.network, deployments: cfg.deployments, rpc });
    return { cfg, k, error, makerUrls: cfg.makers.map((_, i) => `${origin}/api/svc/maker-${i}`), rpc };
  }, [cfg, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRuntime = () => useContext(Ctx);
