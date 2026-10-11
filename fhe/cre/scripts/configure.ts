// Write workflows/decrypt-relay/config.<network>.json from contracts/deployments/<network>.json.
//   node scripts/configure.ts                 # local (gateway http://127.0.0.1:8890)
//   KAKUSHI_FHE_NETWORK=testnet KAKUSHI_FHE_GATEWAY_URL=https://... node scripts/configure.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const network = process.env.KAKUSHI_FHE_NETWORK ?? "local";
const depPath = `${ROOT}contracts/deployments/${network}.json`;
if (!existsSync(depPath)) throw new Error(`no deployment at ${depPath}`);
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const gatewayUrl = process.env.KAKUSHI_FHE_GATEWAY_URL ?? (network === "local" ? "http://127.0.0.1:8890" : undefined);
if (!gatewayUrl) throw new Error("set KAKUSHI_FHE_GATEWAY_URL to the public gateway the DON nodes can reach");

const config = {
  schedule: process.env.CRE_SCHEDULE ?? "*/30 * * * * *",
  chainSelectorName: "monad-testnet",
  oracle: dep.oracle,
  gatewayUrl,
  readAt: network === "local" ? "latest" : "finalized",
  confidence: network === "local" ? "LATEST" : "FINALIZED",
  sweepMax: 8,
  maxWrites: 3,
  gasLimit: "600000",
};
const out = `${ROOT}cre/workflows/decrypt-relay/config.${network === "local" ? "local" : "testnet"}.json`;
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
console.log(`wrote ${out}`);
