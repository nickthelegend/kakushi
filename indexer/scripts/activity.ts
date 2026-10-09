// Generates real Fhish Pay activity on the LOCAL anvil fork so the indexer has something to show:
// wrap (approve + wrap), a private pay() with a reference, a plain confidentialTransfer, two pay links
// claimed by a brand-new account (+ one left open), an operator-run payroll, and an unwrap whose
// amount is revealed by the KMS through the decryption oracle.
//
//   node scripts/activity.ts            (needs the local stack: anvil :18810, gateway :8890)
//
// LOCAL FORK ONLY: uses Foundry's public dev keys. Refuses to run against any other chain/RPC.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FhishClient, waitForDecryption } from "../../sdk/src/index.ts";
import { nativeEncryptor, nodeTfheEncryptor } from "../../sdk/src/node.ts";
import { payAbi } from "../../sdk/src/apps.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RPC = process.env.FHISH_RPC_URL ?? "http://127.0.0.1:18810";
const GATEWAY = process.env.FHISH_GATEWAY_URL ?? "http://127.0.0.1:8890";
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(RPC)) throw new Error("activity.ts only runs against a local fork");

// LOCAL ANVIL ONLY: Foundry's public dev keys
const KEYS = {
  alice: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  bob: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  carol: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
type Who = keyof typeof KEYS;
const addr = (w: Who) => privateKeyToAccount(KEYS[w]).address;

const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local.json`, "utf8"));
const apps = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local-apps.json`, "utf8"));
const TOKEN = apps.causd as Hex;
const AUSD = apps.ausd as Hex;
const chain = defineChain({ id: 10143, name: "Monad testnet (local fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
if ((await pub.getChainId()) !== 10143) throw new Error("not the Monad testnet fork");

const engine = `${ROOT}engine/bin/fhish-engine`;
const fhish = new FhishClient({ gatewayUrl: GATEWAY, chainId: 10143, encryptor: existsSync(engine) ? nativeEncryptor(engine) : nodeTfheEncryptor() });
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);

/** Monad bills the gas limit: estimate, then +30%. */
async function send(who: Who | Hex, address: Hex, abi: any, functionName: string, args: unknown[]) {
  const account = privateKeyToAccount(typeof who === "string" && who in KEYS ? KEYS[who as Who] : (who as Hex));
  const w = createWalletClient({ chain, account, transport: http(RPC) });
  const est = await pub.estimateContractGas({ account, address, abi, functionName, args } as never);
  const hash = await w.writeContract({ chain, account, address, abi, functionName, args, gas: (est * 13n) / 10n } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  console.log(`  ${functionName.padEnd(22)} ${hash} block ${rc.blockNumber} gas ${rc.gasUsed}/${(est * 13n) / 10n}`);
  return rc;
}
const enc = (value: bigint, user: Hex) => fhish.encrypt("euint64", value, TOKEN, user);
const ref = (s: string) => toHex(s, { size: 32 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AU = (n: number) => BigInt(Math.round(n * 1e6)); // AUSD has 6 decimals

console.log(`Fhish Pay activity on ${RPC} · token ${TOKEN} (cAUSD over real Agora AUSD)`);

console.log("1. wrap: approve + wrap (public amounts)");
await send("alice", AUSD, erc20, "approve", [TOKEN, AU(2000)]);
await send("alice", TOKEN, payAbi, "wrap", [AU(2000)]);
await send("bob", AUSD, erc20, "approve", [TOKEN, AU(500)]);
await send("bob", TOKEN, payAbi, "wrap", [AU(500)]);

console.log("2. private pay() with a public reference");
let e = await enc(AU(120), addr("alice"));
await send("alice", TOKEN, payAbi, "pay", [addr("bob"), e.handle, e.proof, ref(`invoice-${Date.now() % 100000}`)]);

console.log("3. plain confidentialTransfer");
e = await enc(AU(15), addr("bob"));
await send("bob", TOKEN, payAbi, "confidentialTransfer", [addr("carol"), e.handle, e.proof]);

console.log("4. pay links: two claimed by a new account (sponsored by carol), one left open");
const newcomer = privateKeyToAccount(generatePrivateKey()).address;
const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
async function link(from: Who, amount: number) {
  const key = generatePrivateKey();
  const x = await enc(AU(amount), addr(from));
  const rc = await send(from, TOKEN, payAbi, "createLink", [x.handle, x.proof, privateKeyToAccount(key).address, expiry]);
  const id = (parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "LinkCreated" })[0] as any).args.id as bigint;
  return { id, key };
}
async function claim(l: { id: bigint; key: Hex }, to: Hex) {
  const digest = (await pub.readContract({ address: TOKEN, abi: payAbi, functionName: "claimDigest", args: [l.id, to] })) as Hex;
  const sig = await privateKeyToAccount(l.key).sign({ hash: digest });
  await send("carol", TOKEN, payAbi, "claimLink", [l.id, to, sig]);
}
const l1 = await link("alice", 40);
const l2 = await link("bob", 10);
await sleep(4000);
await claim(l2, newcomer); // ~4-5 s after creation
await sleep(3000);
await claim(l1, newcomer); // ~8-10 s after creation
const l3 = await link("alice", 5); // stays OPEN
console.log(`  links #${l1.id} #${l2.id} claimed by ${newcomer}; #${l3.id} open`);

console.log("5. payroll run by an operator (carol) for alice");
await send("alice", TOKEN, payAbi, "setOperator", [addr("carol"), Math.floor(Date.now() / 1000) + 86400]);
const staff: [Hex, number][] = [
  [addr("bob"), 320],
  [addr("carol"), 115],
  [newcomer, 60],
];
const salaries = [];
for (const [, amt] of staff) salaries.push(await enc(AU(amt), addr("carol")));
await send("carol", TOKEN, payAbi, "runPayrollFrom", [addr("alice"), staff.map(([w]) => w), salaries.map((s) => s.handle), salaries.map((s) => s.proof), ref("payroll-2026-10")]);

console.log("6. unwrap (cash-out): burn, KMS reveal through the oracle, public payout");
e = await enc(AU(50), addr("bob"));
const ur = await send("bob", TOKEN, payAbi, "unwrap", [e.handle, e.proof]);
const requestId = (parseEventLogs({ abi: payAbi, logs: ur.logs, eventName: "UnwrapRequested" })[0] as any).args.requestId as bigint;
const t0 = Date.now();
await waitForDecryption(pub as never, dep.oracle, requestId);
console.log(`  reveal #${requestId} delivered in ${Date.now() - t0} ms`);
console.log("done");
