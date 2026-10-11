// Create the Kakushi payroll operator on Privy: a policy-fenced server wallet.
//
//   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/privy-setup.ts [--network testnet|local]
//        [--days 30] [--employer 0x...]... [--owner-public-key <base64 P-256 SPKI>] [--dry-run]
//
// 1. creates a Privy policy (app/src/lib/pay/policy.ts): ALLOW eth_signTransaction and
//    eth_sendTransaction only when to == cAUSD, chain_id == 10143, the calldata is runPayrollFrom,
//    and now < notAfter (optionally only for the given employers). Everything else: default DENY.
// 2. creates an Ethereum server wallet with that policy attached (and, optionally, an authorization
//    key as owner so the app secret alone cannot change it).
// 3. prints the env lines for app/.env.local.
//
// --dry-run prints the policy and the plan without calling Privy (works without credentials).
// This script never sends a transaction.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { payrollPolicy } from "../src/lib/pay/policy.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]!] : []));

const network = (opt("network") ?? process.env.KAKUSHI_FHE_NETWORK ?? "testnet") === "local" ? "local" : "testnet";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let token = process.env.KAKUSHI_FHE_PAY_TOKEN as Hex | undefined;
if (!token) {
  try {
    token = JSON.parse(readFileSync(`${ROOT}contracts/deployments/${network}-apps.json`, "utf8")).causd;
  } catch {
    /* handled below */
  }
}
if (!token) {
  console.error(`No cAUSD address: deploy Kakushi Confidential to ${network} first (contracts/deployments/${network}-apps.json) or set KAKUSHI_FHE_PAY_TOKEN.`);
  process.exit(1);
}
const days = Number(opt("days") ?? 30);
const notAfter = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
const employers = many("employer") as Hex[];
const policy = payrollPolicy({ token, notAfter, employers, allowSend: true });

console.log(`Kakushi payroll operator for cAUSD ${token} (${network}), valid until ${new Date(notAfter * 1000).toISOString()}`);
if (flag("dry-run")) {
  console.log("\n--dry-run: the policy that would be created:\n");
  console.log(JSON.stringify(policy, null, 2));
  console.log("\nthen: privy.wallets().create({ chain_type: 'ethereum', policy_ids: [<policy id>] })");
  process.exit(0);
}

const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) {
  console.error("Set PRIVY_APP_ID (or NEXT_PUBLIC_PRIVY_APP_ID) and PRIVY_APP_SECRET from dashboard.privy.io (App settings > Basics). Or run with --dry-run.");
  process.exit(1);
}

const { PrivyClient } = await import("@privy-io/node");
const privy = new PrivyClient({ appId, appSecret });

const created = await privy.policies().create(policy);
console.log(`policy ${created.id} created`);

const ownerKey = opt("owner-public-key") ?? process.env.PRIVY_AUTHORIZATION_PUBLIC_KEY;
const wallet = await privy.wallets().create({
  chain_type: "ethereum",
  policy_ids: [created.id],
  display_name: "Kakushi payroll operator",
  ...(ownerKey ? { owner: { public_key: ownerKey } } : {}),
});
console.log(`server wallet ${wallet.id} at ${wallet.address}`);

console.log(`
Add to app/.env.local, then restart the app:

PRIVY_APP_SECRET=<your app secret>
PRIVY_PAYROLL_WALLET_ID=${wallet.id}
PRIVY_PAYROLL_WALLET_ADDRESS=${wallet.address}
PRIVY_PAYROLL_POLICY_ID=${created.id}${ownerKey ? "\nPRIVY_AUTHORIZATION_PRIVATE_KEY=<the private half of --owner-public-key>" : ""}
# testnet: Privy sponsors the operator's gas (Dashboard > Gas sponsorship > Monad Testnet)
PRIVY_PAYROLL_SPONSOR=${network === "testnet" ? "true" : "false"}
`);
