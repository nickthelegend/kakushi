// Where Kakushi lives. Deployments are embedded at build time (build.mjs) and can be overridden:
//   KAKUSHI_FHE_NETWORK=testnet|local   KAKUSHI_FHE_GATEWAY_URL   KAKUSHI_FHE_RPC_URL (e.g. a local fork)
//   KAKUSHI_FHE_DEPLOYMENT=<path to deployments/<network>.json>   KAKUSHI_FHE_APPS=<path to <network>-apps.json>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import type { KakushiEnv } from "./core.ts";

declare const __KAKUSHI_FHE_DEPLOYMENTS__: Record<string, { core?: { oracle: Hex; chainId: number }; apps?: KakushiEnv["apps"] }> | undefined;

function embedded(network: string) {
  if (typeof __KAKUSHI_FHE_DEPLOYMENTS__ !== "undefined") return __KAKUSHI_FHE_DEPLOYMENTS__[network] ?? {};
  // unbundled (tests): read the repository's deployment files
  const dir = fileURLToPath(new URL("../../../../contracts/deployments/", import.meta.url));
  const read = (f: string) => (existsSync(dir + f) ? JSON.parse(readFileSync(dir + f, "utf8")) : undefined);
  return { core: read(`${network}.json`), apps: read(`${network}-apps.json`) };
}

export function loadEnv(): KakushiEnv & { chainId: number; rpcUrl?: string } {
  const network = process.env.KAKUSHI_FHE_NETWORK ?? "testnet";
  const e = embedded(network);
  const core = process.env.KAKUSHI_FHE_DEPLOYMENT ? JSON.parse(readFileSync(process.env.KAKUSHI_FHE_DEPLOYMENT, "utf8")) : e.core;
  const apps = process.env.KAKUSHI_FHE_APPS ? JSON.parse(readFileSync(process.env.KAKUSHI_FHE_APPS, "utf8")) : (e.apps ?? {});
  if (!core?.oracle) throw new Error(`Kakushi is not deployed on "${network}" in this build; set KAKUSHI_FHE_DEPLOYMENT or KAKUSHI_FHE_NETWORK`);
  return {
    network,
    chainId: Number(core.chainId ?? 10143),
    oracle: core.oracle,
    apps,
    gatewayUrl: process.env.KAKUSHI_FHE_GATEWAY_URL ?? (network === "local" ? "http://127.0.0.1:8890" : "https://gateway.kakushi.xyz"),
    rpcUrl: process.env.KAKUSHI_FHE_RPC_URL ?? (network === "local" ? "http://127.0.0.1:18810" : undefined),
  };
}
