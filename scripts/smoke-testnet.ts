// Live Monad testnet smoke test of Kakushi's ZK privacy layer: real signed transactions, real Monad
// timings (eth_sendRawTransactionSync receipts), commit states (monadNewHeads: Proposed -> Voted ->
// Finalized -> Verified) and the txpool view of each hash.
//
//   set -a; . ./.env.testnet; set +a; node scripts/smoke-testnet.ts
//
// From the deployer (DEPLOYER_PK, never printed): register a stealth meta-address, pay 0.01 MON to it
// through StealthPay, find it by scanning announcements, shield 0.1 MON in the factory pool, then withdraw
// it to a fresh address with an UltraHonk proof generated here. Value sends are spaced >= 3 blocks
// (Monad's reserve rule). Evidence goes to docs/evidence/testnet-smoke.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, defineChain, encodeFunctionData, formatEther, http, parseAbi, parseEther, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STEALTH_KEYS_MESSAGE, IncrementalMerkleTree, buildRegisterKeysCalldata, fieldToHex, generateNote, generateStealthAddress, generateStealthKeys, noteCommitment, noteNullifierHash, readStealthMetaAddress, scanAnnouncements } from "@kakushi/sdk";
import { prove } from "@kakushi/attest-core/prover";
import { COMMIT_STATES, MonadHeads, sendRawSync, type CommitState } from "@kakushi/fhe-sdk/monad";

const RPC = process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pc = createPublicClient({ chain, transport: http(RPC) });
const pk = process.env.DEPLOYER_PK as Hex | undefined;
if (!pk) throw new Error("DEPLOYER_PK not set (source the gitignored .env.testnet)");
const me = privateKeyToAccount(pk);

const dep = JSON.parse(readFileSync(new URL("../config/generated/deployments.testnet.json", import.meta.url), "utf8"));
const priv = dep.chains["10143"].privacy;
const factoryAbi = parseAbi(["function allPools() view returns (address[])"]);
const poolAbi = parseAbi(["function token() view returns (address)", "function denomination() view returns (uint256)", "function deposit(bytes32 commitment) payable", "function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund) payable"]);
const stealthPayAbi = parseAbi(["function sendNative(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes1 viewTag) payable"]);

const heads = new MonadHeads();
await heads.start(); // subscribe to monadNewHeads BEFORE sending, so no state is missed
// first time each (block, state) was seen; a later block reaching a state implies ours did (ordering)
const seen: { n: bigint; state: CommitState; t: number }[] = [];
heads.on((h) => seen.push({ n: h.number, state: h.state, t: h.t }));
async function commitTimeline(block: bigint, sentAt: number, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  const at = (st: CommitState) => {
    const i = COMMIT_STATES.indexOf(st);
    const hit = seen.find((x) => x.n >= block && COMMIT_STATES.indexOf(x.state) >= i);
    return hit ? Math.max(0, hit.t - sentAt) : undefined;
  };
  while (Date.now() < end && at("Verified") === undefined) await sleep(100);
  return Object.fromEntries(COMMIT_STATES.map((st) => [st, at(st) ?? null]));
}
const ONLY_STEALTH = process.argv.includes("--no-pool");
const evidence: Record<string, unknown>[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastValueBlock = 0n;

async function txpoolStatus(hash: Hex): Promise<unknown> {
  try {
    return await pc.request({ method: "txpool_statusByHash" as never, params: [hash] as never });
  } catch (e) {
    return `unsupported: ${(e as Error).message.split("\n")[0]}`;
  }
}

async function send(step: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  if (value > 0n) {
    // reserve rule: space value sends from this account by >= 3 blocks
    while ((await pc.getBlockNumber()) < lastValueBlock + 3n) await sleep(400);
  }
  const [nonce, gasPrice, est] = await Promise.all([
    pc.getTransactionCount({ address: me.address, blockTag: "pending" }),
    pc.getGasPrice(),
    pc.estimateGas({ account: me.address, to, data, value }),
  ]);
  const gas = (est * 115n) / 100n; // Monad bills the limit: keep it tight
  const signed = await me.signTransaction({ chainId: 10143, type: "legacy", nonce, to, data, value, gas, gasPrice: (gasPrice * 110n) / 100n });
  const sentAt = Date.now();
  const r = await sendRawSync(pc as never, signed); // fhe-sdk carries its own viem copy: same client, different type origin
  if (r.status !== "success") throw new Error(`${step} reverted: ${r.hash}`);
  if (value > 0n) lastValueBlock = r.blockNumber;
  const pool = await txpoolStatus(r.hash);
  const timeline = await commitTimeline(r.blockNumber, sentAt);
  const row = { step, hash: r.hash, block: r.blockNumber.toString(), receiptMs: r.ms, syncReceipt: r.sync, gasLimit: gas.toString(), costMON: formatEther(gas * ((gasPrice * 110n) / 100n)), txpool: pool, commit: timeline };
  evidence.push(row);
  console.log(`PASS  ${step.padEnd(34)} ${r.hash}  receipt ${r.ms} ms${r.sync ? " (sync)" : ""}  block ${r.blockNumber}  ${COMMIT_STATES.map((st) => `${st} ${timeline[st] ?? "?"} ms`).join(" · ")}`);
  return r.hash;
}

const balance0 = await pc.getBalance({ address: me.address });
console.log(`deployer ${me.address}: ${formatEther(balance0)} MON`);

// 1. stealth keys + registry
const keys = generateStealthKeys(await me.signMessage({ message: STEALTH_KEYS_MESSAGE }));
const listed = await readStealthMetaAddress(pc, priv.stealthRegistry, me.address);
if (listed?.toLowerCase() === keys.metaAddress.toLowerCase()) console.log("SKIP  register stealth meta-address (already listed)");
else await send("register stealth meta-address", priv.stealthRegistry, buildRegisterKeysCalldata(keys.metaAddress));

// 2. private send through StealthPay
const s = generateStealthAddress(keys.metaAddress);
const sendHash = await send("stealth send 0.01 MON", priv.stealthPay, encodeFunctionData({ abi: stealthPayAbi, functionName: "sendNative", args: [1n, s.stealthAddress, s.ephemeralPublicKey, toHex(s.viewTag, { size: 1 })] }), parseEther("0.01"));

// 3. scan
const sendBlock = (await pc.getTransactionReceipt({ hash: sendHash })).blockNumber;
// load-balanced RPC nodes can lag: never scan below the block the payment landed in
const head = await pc.getBlockNumber();
const found = await scanAnnouncements(pc, priv.stealthAnnouncer, sendBlock - 5n, head > sendBlock ? head : sendBlock, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey, spendingKey: keys.spendingKey }, { withBalances: true });
const hit = found.find((m) => m.stealthAddress.toLowerCase() === s.stealthAddress.toLowerCase());
if (!hit) throw new Error("scanner did not find the stealth payment");
const controls = privateKeyToAccount(hit.stealthPrivateKey!).address.toLowerCase() === s.stealthAddress.toLowerCase();
console.log(`PASS  scanner found it                    ${s.stealthAddress} holds ${formatEther(hit.balance ?? 0n)} MON; derived key controls it: ${controls}`);
evidence.push({ step: "scan", stealthAddress: s.stealthAddress, balance: (hit.balance ?? 0n).toString(), keyControls: controls });

if (ONLY_STEALTH) {
  heads.stop();
  writeEvidence("testnet-smoke-stealth.json");
  process.exit(0);
}
// 4. shield 0.1 MON in the factory pool
const pools = (await pc.readContract({ address: priv.poolFactory, abi: factoryAbi, functionName: "allPools" })) as Hex[];
let pool: Hex | undefined;
for (const p of pools) {
  const [token, denom] = await Promise.all([pc.readContract({ address: p, abi: poolAbi, functionName: "token" }), pc.readContract({ address: p, abi: poolAbi, functionName: "denomination" })]);
  if (/^0x0{40}$/i.test(token as string) && denom === parseEther("0.1")) pool = p;
}
if (!pool) throw new Error("no 0.1 MON pool");
const note = generateNote(10143, pool);
await send("shield 0.1 MON (pool deposit)", pool, encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [fieldToHex(noteCommitment(note))] }), parseEther("0.1"));

// 5. withdraw to a fresh address with a proof made here
const fresh = privateKeyToAccount(generatePrivateKey()).address;
const tree = await IncrementalMerkleTree.fromDeposits(pc, pool, BigInt(priv.deployBlock));
const path = tree.pathForNote(note);
const hx = (x: bigint) => `0x${x.toString(16)}`;
const t0 = Date.now();
const proof = await prove("shielded_withdraw", {
  root: hx(path.root), nullifier_hash: hx(noteNullifierHash(note)), recipient: hx(BigInt(fresh)), relayer: "0x0", fee: "0x0", refund: "0x0",
  chain_id: hx(10143n), pool: hx(BigInt(pool)), ext_data_hash: "0x0", nullifier: hx(note.nullifier), secret: hx(note.secret), path: path.pathElements.map(hx), path_bits: path.pathIndices,
});
const proofMs = Date.now() - t0;
await send(`withdraw to fresh address (proof ${proofMs} ms)`, pool, encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [proof.proof, fieldToHex(path.root), fieldToHex(noteNullifierHash(note)), fresh, "0x0000000000000000000000000000000000000000", 0n, 0n] }));
const got = await pc.getBalance({ address: fresh });
console.log(`PASS  fresh address received               ${fresh}: ${formatEther(got)} MON`);
evidence.push({ step: "fresh balance", fresh, balance: got.toString(), proofMs });

heads.stop();
const balance1 = await pc.getBalance({ address: me.address });
console.log(`spent ${formatEther(balance0 - balance1)} MON (incl. 0.01 sent + 0.1 shielded); deployer now ${formatEther(balance1)} MON`);
writeEvidence("testnet-smoke.json");
process.exit(0);

function writeEvidence(file: string) {
  mkdirSync(new URL("../docs/evidence/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../docs/evidence/${file}`, import.meta.url), JSON.stringify({ at: new Date().toISOString(), chainId: 10143, from: me.address, steps: evidence }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
