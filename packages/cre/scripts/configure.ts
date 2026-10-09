// Writes each workflow's config.<network>.json from the deployments.
//   node scripts/configure.ts [local|testnet]
import { rmSync, writeFileSync } from "node:fs";
import { CHAINS, type ChainKey, type Network, deployedChains } from "@kakushi/config";
import { loadDeployments } from "@kakushi/config/deployments";

const network = (process.argv[2] ?? "local") as Network;
const d = loadDeployments(network);
const hub = { chainSelectorName: CHAINS.monadTestnet.creChainName, oracle: d.hub.attestationOracle, ebc: d.hub.ebc };
/** one kakushi-attest-<chain> workflow folder per chain */
const instances: Record<ChainKey, string> = {
  monadTestnet: "attest-monad",
  sepolia: "attest-sepolia",
  baseSepolia: "attest-base",
  arbitrumSepolia: "attest-arbitrum",
  opSepolia: "attest-op",
};
for (const [key, folder] of Object.entries(instances) as [ChainKey, string][]) {
  const c = CHAINS[key];
  const dep = d.chains[c.chainId];
  const file = new URL(`../workflows/${folder}/config.${network}.json`, import.meta.url);
  if (!dep) {
    // not in this deployment (e.g. the local stack without its optional forks): no stale config
    rmSync(file, { force: true });
    console.log(`skipped ${folder}: ${c.name} is not deployed on ${network}`);
    continue;
  }
  const cfg = {
    // CRE's fastest cron is every 30 s
    schedule: "*/30 * * * * *",
    hub,
    chain: {
      chainSelectorName: c.creChainName,
      chainId: c.chainId,
      payoutRouter: dep.payoutRouter,
      sourceRouter: dep.sourceRouter,
      tokens: [c.usdc.address],
      startBlock: String(dep.deployBlock),
      head: network === "testnet" && c.finality === "monad" ? "finalized" : "latest",
      confirmations: network === "local" ? 0 : c.attestConfirmations,
      maxBlocks: 100,
    },
    gasLimit: "1500000",
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}
const rpc = (k: ChainKey) => (network === "local" ? `http://127.0.0.1:${CHAINS[k].localPort}` : CHAINS[k].publicRpc);
const covered = deployedChains(d);
const native = {
  hub,
  rpcs: Object.fromEntries(covered.map((c) => [String(c.chainId), rpc(c.key)])),
  confirmations: Object.fromEntries(covered.map((c) => [String(c.chainId), network === "local" ? 0 : c.attestConfirmations])),
  authorizedKeys: [],
  gasLimit: "600000",
};
writeFileSync(new URL(`../workflows/source-native/config.${network}.json`, import.meta.url), JSON.stringify(native, null, 2) + "\n");
console.log(`wrote CRE configs for ${network}`);
