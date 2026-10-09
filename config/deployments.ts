// Deployment addresses written by packages/contracts/script/Deploy.s.sol to
// packages/contracts/deployments/<network>/<chainId>.json (Node only).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHAIN_LIST, currentNetwork, type Network } from "./chains.ts";

export interface SpokeDeployment {
  chainId: number;
  deployBlock: number;
  deployer: `0x${string}`;
  payoutRouter: `0x${string}`;
  sourceRouter: `0x${string}`;
  role: "hub" | "spoke";
  /** written by script/DeployPrivacy.s.sol; absent until the privacy layer is deployed there */
  privacy?: PrivacyDeployment;
}

/** One fixed-denomination KakushiPool. */
export interface PrivacyPoolDeployment {
  address: `0x${string}`;
  /** 0x0 = the chain's native coin */
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** base units, decimal string (exceeds 2^53 for native pools) */
  denomination: string;
}

/** Privacy layer of one chain: ERC-6538 registry, ERC-5564 announcer, StealthPay (same address
 *  on every chain) and the shielded pools keyed by label ("MON-1", "ETH-0.01", "USDC-100", ...). */
export interface PrivacyDeployment {
  deployBlock: number;
  stealthRegistry: `0x${string}`;
  stealthAnnouncer: `0x${string}`;
  stealthPay: `0x${string}`;
  shieldedVerifier: `0x${string}`;
  /** permissionless KakushiPoolFactory ("any token -> private"); absent in records written before it */
  poolFactory?: `0x${string}`;
  pools: Record<string, PrivacyPoolDeployment>;
}

export interface HubDeployment extends SpokeDeployment {
  ebc: `0x${string}`;
  mdc: `0x${string}`;
  attestationOracle: `0x${string}`;
  disputeModule: `0x${string}`;
  complianceVerifier: `0x${string}`;
  inclusionVerifier: `0x${string}`;
  creForwarder: `0x${string}`;
  fillWindow: number;
  disputeWindow: number;
  clockSkew: number;
  paramDelay: number;
  withdrawDelay: number;
  bond: number | string;
  domain: `0x${string}`;
}

export interface Deployments {
  network: Network;
  hub: HubDeployment;
  chains: Record<number, SpokeDeployment>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEPLOYMENTS_DIR = join(here, "..", "packages", "contracts", "deployments");

/** The hub record is required; spokes are optional. `chains` holds exactly the chains with a
 *  record, so a deployment that skips a spoke (the local stack without its optional forks)
 *  simply does not cover it. See deployedChains() in chains.ts. */
export function loadDeployments(network: Network = currentNetwork(), dir: string = DEPLOYMENTS_DIR): Deployments {
  const chains: Record<number, SpokeDeployment> = {};
  let hub: HubDeployment | undefined;
  for (const c of CHAIN_LIST) {
    const p = join(dir, network, `${c.chainId}.json`);
    if (!existsSync(p)) {
      if (c.isHub) throw new Error(`missing deployment ${p}: run pnpm deploy:local (or the testnet runbook)`);
      continue;
    }
    const d = JSON.parse(readFileSync(p, "utf8")) as SpokeDeployment & Partial<HubDeployment>;
    if (Number(d.chainId) !== c.chainId) throw new Error(`deployment ${p} records chain ${d.chainId}`);
    if ((d.role === "hub") !== c.isHub) throw new Error(`deployment ${p} has role ${d.role}`);
    const privacy = parsePrivacy(d.privacy);
    if (privacy) d.privacy = privacy;
    else delete d.privacy;
    chains[c.chainId] = d;
    if (d.role === "hub") hub = d as HubDeployment;
  }
  if (!hub) throw new Error(`no hub deployment for ${network}`);
  if (Object.keys(chains).length < 2) throw new Error(`no spoke deployment for ${network}: deploy at least one spoke`);
  return { network, hub, chains };
}

const isAddr = (x: unknown): x is `0x${string}` => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);

/** Tolerant: a missing or malformed `privacy` object yields undefined (the chain simply has no
 *  privacy layer); malformed pool entries are dropped individually. */
export function parsePrivacy(raw: unknown): PrivacyDeployment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  if (![p.stealthRegistry, p.stealthAnnouncer, p.stealthPay, p.shieldedVerifier].every(isAddr)) return undefined;
  const pools: Record<string, PrivacyPoolDeployment> = {};
  if (p.pools && typeof p.pools === "object") {
    for (const [label, v] of Object.entries(p.pools as Record<string, unknown>)) {
      const e = v as Record<string, unknown> | null;
      if (!e || !isAddr(e.address) || !isAddr(e.token)) continue;
      const denomination = String(e.denomination ?? "");
      if (!/^[0-9]+$/.test(denomination) || denomination === "0") continue;
      pools[label] = {
        address: e.address,
        token: e.token,
        symbol: typeof e.symbol === "string" ? e.symbol : label.split("-")[0]!,
        decimals: Number(e.decimals ?? 18),
        denomination,
      };
    }
  }
  return {
    deployBlock: Number(p.deployBlock ?? 0),
    stealthRegistry: p.stealthRegistry as `0x${string}`,
    stealthAnnouncer: p.stealthAnnouncer as `0x${string}`,
    stealthPay: p.stealthPay as `0x${string}`,
    shieldedVerifier: p.shieldedVerifier as `0x${string}`,
    ...(isAddr(p.poolFactory) ? { poolFactory: p.poolFactory } : {}),
    pools,
  };
}
