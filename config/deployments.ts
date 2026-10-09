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
    chains[c.chainId] = d;
    if (d.role === "hub") hub = d as HubDeployment;
  }
  if (!hub) throw new Error(`no hub deployment for ${network}`);
  if (Object.keys(chains).length < 2) throw new Error(`no spoke deployment for ${network}: deploy at least one spoke`);
  return { network, hub, chains };
}
