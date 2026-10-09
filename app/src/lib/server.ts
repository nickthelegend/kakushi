// Server-only runtime config. FHISH_NETWORK=local|testnet.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const network = () => (process.env.FHISH_NETWORK === "testnet" ? "testnet" : "local");
export const rpcUrl = () => process.env.RPC_URL ?? (network() === "local" ? "http://127.0.0.1:18810" : "https://testnet-rpc.monad.xyz");
export const gatewayUrl = () => process.env.FHISH_GATEWAY_URL ?? "http://127.0.0.1:8890";

export function config() {
  const p = resolve(process.cwd(), `../contracts/deployments/${network()}.json`);
  const deployment = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  const ap = resolve(process.cwd(), `../contracts/deployments/${network()}-apps.json`);
  const apps = existsSync(ap) ? JSON.parse(readFileSync(ap, "utf8")) : null;
  return {
    network: network(),
    chainId: 10143,
    deployment,
    apps,
    // LOCAL ANVIL ONLY: Foundry's public dev keys, for the local playground without a wallet
    localKeys: network() === "local"
      ? [
          { label: "Alice (anvil #1)", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
          { label: "Bob (anvil #2)", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
          { label: "Carol (anvil #3)", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
        ]
      : [],
  };
}
