// Server-only: runtime config for the browser, read from config/generated (written by the
// deploy scripts). Network is chosen by KAKUSHI_NETWORK (local | testnet).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type Network = "local" | "testnet";

export interface MakerEntry {
  name: string;
  address: `0x${string}`;
  url: string;
}

export interface RuntimeConfig {
  network: Network;
  deployments: unknown | null;
  makers: MakerEntry[];
  services: { attester: string | null; watchtower: string | null; indexer: string | null };
  privyAppId: string | null;
  envioStatsEnabled: boolean;
  /** LOCAL ANVIL ONLY: public dev keys for the local-fork demo wallet. Never set on testnet. */
  localDevKeys: { label: string; key: `0x${string}` }[];
  error?: string;
}

const dir = () => process.env.KAKUSHI_CONFIG_DIR ?? resolve(process.cwd(), "../../config/generated");

export function network(): Network {
  const hosted = Boolean(process.env.VERCEL);
  const value = process.env.KAKUSHI_NETWORK ?? (process.env.NODE_ENV === "production" || hosted ? "testnet" : "local");
  if (value !== "local" && value !== "testnet") throw new Error("KAKUSHI_NETWORK must be local or testnet");
  if (hosted && value === "local") throw new Error("Hosted Kakushi must use testnet; local demo signing is unavailable on public hosts");
  return value;
}

export function runtimeConfig(): RuntimeConfig {
  const n = network();
  const depPath = resolve(dir(), `deployments.${n}.json`);
  const makersPath = resolve(dir(), `makers.${n}.json`);
  const deployments = existsSync(depPath) ? JSON.parse(readFileSync(depPath, "utf8")) : null;
  const makers: MakerEntry[] = existsSync(makersPath) ? JSON.parse(readFileSync(makersPath, "utf8")) : [];
  return {
    network: n,
    deployments,
    makers,
    services: {
      attester: process.env.KAKUSHI_ATTESTER_URL ?? (n === "local" ? "http://127.0.0.1:3714" : null),
      watchtower: process.env.KAKUSHI_WATCHTOWER_URL ?? (n === "local" ? "http://127.0.0.1:3713" : null),
      indexer: process.env.KAKUSHI_INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? (n === "local" ? "http://127.0.0.1:4201" : null),
    },
    privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? null,
    envioStatsEnabled: Boolean(process.env.KAKUSHI_ENVIO_GRAPHQL_URL),
    localDevKeys:
      n === "local"
        ? [
            { label: "Local fork user (anvil #4)", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
            { label: "Local fork user 2 (anvil #6)", key: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" },
            { label: "Maker A (anvil #1)", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
            { label: "Maker B (anvil #2)", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
          ]
        : [],
    error: deployments ? undefined : "Kakushi is not deployed on this network yet.",
  };
}

/** The browser receives same-origin proxy paths, never internal service URLs or URL credentials. */
export function publicRuntimeConfig(): RuntimeConfig {
  const cfg = runtimeConfig();
  return {
    ...cfg,
    makers: cfg.makers.map((maker, index) => ({ ...maker, url: `/api/svc/maker-${index}` })),
    services: {
      attester: cfg.services.attester ? "/api/svc/attester" : null,
      watchtower: cfg.services.watchtower ? "/api/svc/watchtower" : null,
      indexer: cfg.services.indexer ? "/api/svc/indexer" : null,
    },
  };
}

/** RPC URL per chain id for the proxy (keys stay server-side on testnet). */
export function rpcFor(chainId: number): string | null {
  const n = network();
  const table: Record<number, { env: string; local: number; pub: string }> = {
    10143: { env: "MONAD_TESTNET_RPC_URL", local: 18710, pub: "https://testnet-rpc.monad.xyz" },
    11155111: { env: "SEPOLIA_RPC_URL", local: 18711, pub: "https://ethereum-sepolia-rpc.publicnode.com" },
    84532: { env: "BASE_SEPOLIA_RPC_URL", local: 18712, pub: "https://sepolia.base.org" },
  };
  const t = table[chainId];
  if (!t) return null;
  // Local public dev keys must never be routed to a public network by a
  // testnet provider variable inherited from another service or shell.
  return n === "local" ? `http://127.0.0.1:${t.local}` : process.env[t.env] || t.pub;
}
