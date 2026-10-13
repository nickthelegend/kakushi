// Create a Kakushi Maker hot wallet on Privy: a server wallet fenced by a policy.
//
//   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/privy-setup.ts [--network testnet] [--max-native-wei 2000000000000000]
//        [--owner-public-key <base64 P-256 SPKI>] [--dry-run] [--update-policy <policy id>]
//
// --update-policy rewrites an existing policy's rules in place (e.g. after a new spoke deploys) and
// keeps its wallet; without it a new policy and a new server wallet are created.
//
// The policy (default DENY; every condition in a rule must hold) allows only:
//   - PayoutRouter.fill / refund on the deployed chains, with at most --max-native-wei of native value
//   - DisputeModule.answerDispute on the Monad hub
//   - USDC.approve where the spender is the PayoutRouter or the MDC
//   - MDC.depositMargin, EBC.registerPair / setActive on the Monad hub (setting the Maker up)
// So a compromised Maker host can fill and answer disputes, but cannot move inventory or margin anywhere else.
// Addresses come from config/generated/deployments.<network>.json. This script never sends a transaction.
import { readFileSync } from "node:fs";
import { getAddress, parseAbi, type Hex } from "viem";
import { CHAINS } from "@kakushi/config";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const network = opt("network") ?? "testnet";
const maxNative = opt("max-native-wei") ?? "2000000000000000";
const dep = JSON.parse(readFileSync(new URL(`../../../config/generated/deployments.${network}.json`, import.meta.url), "utf8"));
const hub = dep.hub;
const chainEntries = Object.entries(dep.chains as Record<string, { payoutRouter: Hex }>);
if (!hub || !chainEntries.length) throw new Error(`no ${network} deployment`);

const both = (a: string) => [a.toLowerCase(), getAddress(a)];
const chainIds = chainEntries.map(([id]) => id);
const routers = [...new Set(chainEntries.flatMap(([, c]) => both(c.payoutRouter)))];
const usdcs = [...new Set(chainEntries.flatMap(([id]) => Object.values(CHAINS).filter((c) => String(c.chainId) === id).flatMap((c) => both(c.usdc.address))))];
const MONAD = String(CHAINS.monadTestnet.chainId);

const ROUTER_ABI = parseAbi(["function fill(bytes32 srcRef, address recipient, address token, uint256 amount) payable", "function refund(bytes32 srcRef, address recipient, address token, uint256 amount) payable"]);
const DM_ABI = parseAbi(["struct Claim { uint64 srcChainId; bytes32 srcTxHash; uint32 logIndex; address maker; }", "function answerDispute(Claim c, uint256 payoutWindowId, bytes proof)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const MDC_ABI = parseAbi(["function depositMargin(address token, uint256 amount)"]);
const EBC_ABI = parseAbi(["function setActive(bytes32 pairId, bool active)"]);

type Cond = Record<string, unknown>;
const tx = (field: string, operator: string, value: unknown): Cond => ({ field_source: "ethereum_transaction", field, operator, value });
const call = (abi: unknown, field: string, operator: string, value: unknown): Cond => ({ field_source: "ethereum_calldata", field, abi, operator, value });

const groups: { name: string; conditions: Cond[] }[] = [
  { name: "router fill/refund", conditions: [tx("to", "in", routers), tx("chain_id", "in", chainIds), tx("value", "lte", maxNative), call(ROUTER_ABI, "function_name", "in", ["fill", "refund"])] },
  { name: "answerDispute", conditions: [tx("to", "in", both(hub.disputeModule)), tx("chain_id", "eq", MONAD), call(DM_ABI, "function_name", "eq", "answerDispute")] },
  { name: "USDC approve router/MDC", conditions: [tx("to", "in", usdcs), tx("chain_id", "in", chainIds), call(APPROVE_ABI, "approve.spender", "in", [...routers, ...both(hub.mdc)])] },
  { name: "MDC depositMargin", conditions: [tx("to", "in", both(hub.mdc)), tx("chain_id", "eq", MONAD), call(MDC_ABI, "function_name", "eq", "depositMargin")] },
  { name: "EBC setActive", conditions: [tx("to", "in", both(hub.ebc)), tx("chain_id", "eq", MONAD), call(EBC_ABI, "function_name", "eq", "setActive")] },
];
const policy = {
  version: "1.0",
  name: "Kakushi Maker hot wallet",
  chain_type: "ethereum",
  rules: groups.flatMap((g) => (["eth_signTransaction", "eth_sendTransaction"] as const).map((method) => ({ name: `${method === "eth_signTransaction" ? "sign" : "send"}: ${g.name}` /* Privy: < 50 chars */, method, action: "ALLOW", conditions: g.conditions }))),
};

console.log(`Kakushi Maker policy (${network}): ${policy.rules.length} rules over chains ${chainIds.join(", ")}`);
if (flag("dry-run")) {
  console.log(JSON.stringify(policy, null, 2));
  process.exit(0);
}
const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) throw new Error("Set PRIVY_APP_ID and PRIVY_APP_SECRET (e.g. source the gitignored .env.testnet), or run with --dry-run");
const { PrivyClient } = await import("@privy-io/node");
const privy = new PrivyClient({ appId, appSecret });
const updateId = opt("update-policy");
if (updateId) {
  const updated = await privy.policies().update(updateId, { name: policy.name, rules: policy.rules } as never);
  console.log(`policy ${updated.id} updated: ${updated.rules.length} rules over chains ${chainIds.join(", ")}`);
  process.exit(0);
}
const created = await privy.policies().create(policy as never);
const ownerKey = opt("owner-public-key") ?? process.env.PRIVY_AUTHORIZATION_PUBLIC_KEY;
const wallet = await privy.wallets().create({ chain_type: "ethereum", policy_ids: [created.id], display_name: "Kakushi Maker", ...(ownerKey ? { owner: { public_key: ownerKey } } : {}) });
// ids and the address are not secrets; the app secret is never printed
console.log(`policy ${created.id}\nserver wallet ${wallet.id} at ${wallet.address}`);
console.log(`\nMaker env: PRIVY_MAKER_WALLET_ID=${wallet.id} PRIVY_MAKER_WALLET_ADDRESS=${wallet.address} (plus PRIVY_APP_ID / PRIVY_APP_SECRET)`);
