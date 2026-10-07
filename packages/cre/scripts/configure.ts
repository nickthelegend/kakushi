// Writes each workflow's config.<network>.json from the deployments.
//   node scripts/configure.ts [local|testnet]
import { writeFileSync } from "node:fs";
import { CHAINS, type ChainKey, type Network } from "@kakushi/config";
import { loadDeployments } from "@kakushi/config/deployments";

const network = (process.argv[2] ?? "local") as Network;
const d = loadDeployments(network);
const hub = { chainSelectorName: CHAINS.monadTestnet.creChainName, oracle: d.hub.attestationOracle, ebc: d.hub.ebc };
const instances: [string, ChainKey][] = [
  ["attest-monad", "monadTestnet"],
  ["attest-sepolia", "sepolia"],
  ["attest-base", "baseSepolia"],
];
for (const [folder, key] of instances) {
  const c = CHAINS[key];
  const dep = d.chains[c.chainId]!;
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
  writeFileSync(new URL(`../workflows/${folder}/config.${network}.json`, import.meta.url), JSON.stringify(cfg, null, 2) + "\n");
}
const rpc = (k: ChainKey) => (network === "local" ? `http://127.0.0.1:${CHAINS[k].localPort}` : CHAINS[k].publicRpc);
const native = {
  hub,
  rpcs: Object.fromEntries((Object.keys(CHAINS) as ChainKey[]).map((k) => [String(CHAINS[k].chainId), rpc(k)])),
  confirmations: Object.fromEntries((Object.keys(CHAINS) as ChainKey[]).map((k) => [String(CHAINS[k].chainId), network === "local" ? 0 : CHAINS[k].attestConfirmations])),
  authorizedKeys: [],
  gasLimit: "600000",
};
writeFileSync(new URL(`../workflows/source-native/config.${network}.json`, import.meta.url), JSON.stringify(native, null, 2) + "\n");
console.log(`wrote CRE configs for ${network}`);
