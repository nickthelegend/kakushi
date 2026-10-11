// Where Fhish lives. Deployments are embedded at build time (build.mjs) and can be overridden:
//   FHISH_NETWORK=testnet|local   FHISH_GATEWAY_URL   FHISH_RPC_URL (e.g. a local fork)
//   FHISH_DEPLOYMENT=<path to deployments/<network>.json>   FHISH_APPS=<path to <network>-apps.json>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import type { FhishEnv } from "./core.ts";

declare const __FHISH_DEPLOYMENTS__: Record<string, { core?: { oracle: Hex; chainId: number }; apps?: FhishEnv["apps"] }> | undefined;

function embedded(network: string) {
  if (typeof __FHISH_DEPLOYMENTS__ !== "undefined") return __FHISH_DEPLOYMENTS__[network] ?? {};
  // unbundled (tests): read the repository's deployment files
  const dir = fileURLToPath(new URL("../../../../contracts/deployments/", import.meta.url));
  const read = (f: string) => (existsSync(dir + f) ? JSON.parse(readFileSync(dir + f, "utf8")) : undefined);
  return { core: read(`${network}.json`), apps: read(`${network}-apps.json`) };
}

export function loadEnv(): FhishEnv & { chainId: number; rpcUrl?: string } {
  const network = process.env.FHISH_NETWORK ?? "testnet";
  const e = embedded(network);
  const core = process.env.FHISH_DEPLOYMENT ? JSON.parse(readFileSync(process.env.FHISH_DEPLOYMENT, "utf8")) : e.core;
  const apps = process.env.FHISH_APPS ? JSON.parse(readFileSync(process.env.FHISH_APPS, "utf8")) : (e.apps ?? {});
  if (!core?.oracle) throw new Error(`Fhish is not deployed on "${network}" in this build; set FHISH_DEPLOYMENT or FHISH_NETWORK`);
  return {
    network,
    chainId: Number(core.chainId ?? 10143),
    oracle: core.oracle,
    apps,
    gatewayUrl: process.env.FHISH_GATEWAY_URL ?? (network === "local" ? "http://127.0.0.1:8890" : "https://gateway.fhish.xyz"),
    rpcUrl: process.env.FHISH_RPC_URL ?? (network === "local" ? "http://127.0.0.1:18810" : undefined),
  };
}
