// Server-only runtime config. KAKUSHI_FHE_NETWORK=local|testnet.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export const network = () => (process.env.KAKUSHI_FHE_NETWORK === "testnet" ? "testnet" : "local");
export const rpcUrl = () => process.env.RPC_URL ?? (network() === "local" ? "http://127.0.0.1:18810" : "https://testnet-rpc.monad.xyz");
export const gatewayUrl = () => process.env.KAKUSHI_FHE_GATEWAY_URL ?? "http://127.0.0.1:8890";

// LOCAL ANVIL ONLY: Foundry's public dev keys. Never funded anywhere but the local fork.
const LOCAL_KEYS = [
  { label: "Alice (anvil #1)", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  { label: "Bob (anvil #2)", key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { label: "Carol (anvil #3)", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
] as const;
/** LOCAL ANVIL ONLY (#7): stands in for the Privy server wallet that runs payroll as an operator. */
export const LOCAL_OPERATOR_KEY: Hex = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";
/** LOCAL ANVIL ONLY (#8): stands in for Privy's paymaster: submits link claims for accounts with no gas. */
export const LOCAL_SPONSOR_KEY: Hex = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97";

export function readDeployments() {
  const p = resolve(process.cwd(), `../contracts/deployments/${network()}.json`);
  const deployment = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  const ap = resolve(process.cwd(), `../contracts/deployments/${network()}-apps.json`);
  const apps = existsSync(ap) ? JSON.parse(readFileSync(ap, "utf8")) : null;
  return { deployment, apps };
}

/** Privy server-side settings. Secrets never leave the server; config() only reports what is set. */
export function privyServer() {
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? null;
  const appSecret = process.env.PRIVY_APP_SECRET ?? null;
  const walletId = process.env.PRIVY_PAYROLL_WALLET_ID ?? null;
  const walletAddress = (process.env.PRIVY_PAYROLL_WALLET_ADDRESS as Hex | undefined) ?? null;
  return {
    appId,
    appSecret,
    walletId,
    walletAddress,
    policyId: process.env.PRIVY_PAYROLL_POLICY_ID ?? null,
    authorizationKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ?? null,
    // Privy native gas sponsorship (EIP-7702 + paymaster) exists on Monad testnet, not on a local fork.
    sponsor: process.env.PRIVY_PAYROLL_SPONSOR ? process.env.PRIVY_PAYROLL_SPONSOR === "true" : network() === "testnet",
    serverWalletReady: Boolean(appId && appSecret && walletId && walletAddress),
  };
}

/** Who runs payroll on an employer's behalf: the Privy server wallet if configured, else (fork only) a dev key. */
export function payrollOperator(): { address: Hex; kind: "privy-server-wallet" | "local-dev-key"; policyId: string | null } | null {
  const p = privyServer();
  if (p.serverWalletReady) return { address: p.walletAddress!, kind: "privy-server-wallet", policyId: p.policyId };
  if (network() === "local") return { address: privateKeyToAccount(LOCAL_OPERATOR_KEY).address, kind: "local-dev-key", policyId: null };
  return null;
}

export function config() {
  const { deployment, apps } = readDeployments();
  const p = privyServer();
  const op = payrollOperator();
  return {
    network: network(),
    chainId: 10143,
    deployment,
    apps,
    // LOCAL ANVIL ONLY: Foundry's public dev keys, for the local playground without a wallet
    localKeys: network() === "local" ? LOCAL_KEYS.map((k) => ({ ...k })) : [],
    pay: {
      operator: op,
      // the local stand-in for Privy's paymaster (fork only)
      localSponsor: network() === "local" ? privateKeyToAccount(LOCAL_SPONSOR_KEY).address : null,
    },
    privy: {
      appIdConfigured: Boolean(p.appId),
      serverWallet: p.serverWalletReady,
      sponsor: p.sponsor,
    },
  };
}
