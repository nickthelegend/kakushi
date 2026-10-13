// Team-seeded demo activity on Monad testnet (13 Oct): five distinct wallets shield 0.1 MON each in the
// factory pool (an anonymity set of more than one), two notes are withdrawn to brand-new addresses
// through the relayer key (the depositors never touch their withdrawals), and one wallet makes a
// stealth payment.
//
//   set -a; . ./.env.testnet; set +a; node scripts/seed-testnet.ts
//
// Keys (DEPLOYER_PK funds the wallets, RELAYER_KEY sends the withdrawals) are never printed. The seed
// wallets' keys and notes go to .stack/seed-13oct.json (gitignored), so a re-run resumes. Evidence:
// docs/evidence/seed-13oct.md. This activity is the team's, for the demo; it is labelled so everywhere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, formatEther, parseAbi, parseEther, parseEventLogs, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { IncrementalMerkleTree, STEALTH_KEYS_MESSAGE, fieldToHex, generateNote, generateStealthAddress, generateStealthKeys, noteCommitment, noteNullifierHash, parseNote, publicClient, readStealthMetaAddress, serializeNote } from "@kakushi/sdk";
import { prove } from "@kakushi/attest-core/prover";

const env = (k: string) => {
  const v = process.env[k] as Hex | undefined;
  if (!v) throw new Error(`${k} not set (source the gitignored .env.testnet)`);
  return v;
};
const deployer = privateKeyToAccount(env("DEPLOYER_PK"));
const relayer = privateKeyToAccount(env("RELAYER_KEY"));
const pc = publicClient("monadTestnet", "testnet");
const dep = JSON.parse(readFileSync(new URL("../config/generated/deployments.testnet.json", import.meta.url), "utf8"));
const priv = dep.chains["10143"].privacy;
const pool = (Object.values(priv.pools) as { address: Hex; token: Hex; denomination: string }[]).find((p) => /^0x0{40}$/i.test(p.token) && p.denomination === parseEther("0.1").toString())!.address;
const DENOM = parseEther("0.1");
const poolAbi = parseAbi(["function deposit(bytes32 commitment) payable", "function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund) payable"]);
const stealthPayAbi = parseAbi(["function sendNative(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes1 viewTag) payable"]);

const STATE = new URL("../.stack/seed-13oct.json", import.meta.url);
type Seed = { key: Hex; funded?: Hex; deposit?: Hex; note?: string; withdrawn?: { tx: Hex; to: Hex } };
const state: { wallets: Seed[]; stealth?: Hex } = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { wallets: Array.from({ length: 5 }, () => ({ key: generatePrivateKey() })) };
const save = () => {
  mkdirSync(new URL("../.stack/", import.meta.url), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
};
save();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Monad: value sends follow >= 3 idle blocks for the sender (reserve rule); limits are estimate + 15% (billed). */
async function send(from: PrivateKeyAccount, to: Hex, data: Hex | undefined, value: bigint): Promise<Hex> {
  if (value > 0n) await sleep(1500);
  const [nonce, est, price] = await Promise.all([pc.getTransactionCount({ address: from.address, blockTag: "pending" }), pc.estimateGas({ account: from.address, to, data, value }), pc.getGasPrice()]);
  const raw = await from.signTransaction({ chainId: 10143, type: "legacy", nonce, to, data, value, gas: (est * 115n) / 100n, gasPrice: (price * 110n) / 100n });
  const hash = await pc.sendRawTransaction({ serializedTransaction: raw });
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`reverted ${hash}`);
  return hash;
}

const before = { deployer: await pc.getBalance({ address: deployer.address }), relayer: await pc.getBalance({ address: relayer.address }) };

// 1. fund and deposit from five distinct wallets
for (const [i, w] of state.wallets.entries()) {
  const acct = privateKeyToAccount(w.key);
  if (!w.funded) {
    w.funded = await send(deployer, acct.address, undefined, parseEther(i === 0 ? "0.2" : "0.17"));
    save();
  }
  if (!w.deposit) {
    const note = generateNote(10143, pool);
    w.note = serializeNote(note);
    save();
    w.deposit = await send(acct, pool, encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [fieldToHex(noteCommitment(note))] }), DENOM);
    save();
  }
  console.log(`wallet ${i + 1} ${acct.address}: deposit ${w.deposit}`);
}

// 2. two withdrawals to brand-new addresses, sent by the relayer key (fee 0: the team pays the gas)
// The pool's leaves come from known deposit receipts (the 12 Oct smoke deposit + the five above),
// checked against the pool's own count: scanning ~250k Monad blocks 100 at a time is far slower.
// The contract checks the resulting root again on every withdraw.
const KNOWN_DEPOSITS: Hex[] = ["0x94531ecb05ab522f0cbdd1d6d0411188fd29e3e46bad0adb863406ef2245a32a", ...state.wallets.map((w) => w.deposit!)];
const depositEvent = parseAbi(["event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)"]);
const leaves = new Map<number, bigint>();
for (const h of KNOWN_DEPOSITS) {
  for (const ev of parseEventLogs({ abi: depositEvent, logs: (await pc.getTransactionReceipt({ hash: h })).logs.filter((l) => l.address.toLowerCase() === pool.toLowerCase()) })) leaves.set(Number(ev.args.leafIndex), BigInt(ev.args.commitment));
}
const count = Number(await pc.readContract({ address: pool, abi: parseAbi(["function nextIndex() view returns (uint32)"]), functionName: "nextIndex" }));
if (leaves.size !== count) throw new Error(`pool has ${count} deposits, ${leaves.size} known: rebuild with IncrementalMerkleTree.fromDeposits`);
const tree = new IncrementalMerkleTree([...Array(count).keys()].map((i) => leaves.get(i)!));
const hx = (x: bigint) => `0x${x.toString(16)}`;
for (const i of [1, 3]) {
  const w = state.wallets[i]!;
  if (w.withdrawn) continue;
  const note = parseNote(w.note!);
  const path = tree.pathForNote(note);
  const to = privateKeyToAccount(generatePrivateKey()).address;
  const proof = await prove("shielded_withdraw", {
    root: hx(path.root), nullifier_hash: hx(noteNullifierHash(note)), recipient: hx(BigInt(to)), relayer: hx(BigInt(relayer.address)), fee: "0x0", refund: "0x0",
    chain_id: hx(10143n), pool: hx(BigInt(pool)), ext_data_hash: "0x0", nullifier: hx(note.nullifier), secret: hx(note.secret), path: path.pathElements.map(hx), path_bits: path.pathIndices,
  });
  const tx = await send(relayer, pool, encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [proof.proof, fieldToHex(path.root), fieldToHex(noteNullifierHash(note)), to, relayer.address, 0n, 0n] }), 0n);
  w.withdrawn = { tx, to };
  save();
  console.log(`withdraw note of wallet ${i + 1} -> fresh ${to}: ${tx} (${formatEther(await pc.getBalance({ address: to }))} MON)`);
}

// 3. one stealth payment: wallet 1 pays the deployer's registered meta-address
if (!state.stealth) {
  const keys = generateStealthKeys(await deployer.signMessage({ message: STEALTH_KEYS_MESSAGE }));
  const meta = await readStealthMetaAddress(pc, priv.stealthRegistry, deployer.address);
  if (meta?.toLowerCase() !== keys.metaAddress.toLowerCase()) throw new Error("deployer meta-address not registered");
  const s = generateStealthAddress(meta);
  state.stealth = await send(privateKeyToAccount(state.wallets[0]!.key), priv.stealthPay, encodeFunctionData({ abi: stealthPayAbi, functionName: "sendNative", args: [1n, s.stealthAddress, s.ephemeralPublicKey, toHex(s.viewTag, { size: 1 })] }), parseEther("0.01"));
  save();
}
console.log(`stealth pay ${state.stealth}`);

const after = { deployer: await pc.getBalance({ address: deployer.address }), relayer: await pc.getBalance({ address: relayer.address }) };
const spent = before.deployer - after.deployer + (before.relayer - after.relayer);
console.log(`spent this run: ${formatEther(spent)} MON (deployer ${formatEther(before.deployer - after.deployer)}, relayer ${formatEther(before.relayer - after.relayer)})`);

const md = [
  "# Seeded activity, 13 Oct 2026 (Monad testnet)",
  "",
  "**Seeded by the team for the demo.** These wallets are ours, funded from the deployer. They are not organic users. The point is that the 0.1 MON pool has an anonymity set larger than one, and that withdrawals go to addresses no depositor has touched. Produced by `scripts/seed-testnet.ts`.",
  "",
  `Pool: 0.1 MON \`${pool}\`.`,
  "",
  "| Wallet | Funded (from deployer) | Shield deposit |",
  "| --- | --- | --- |",
  ...state.wallets.map((w, i) => `| ${i + 1}: \`${privateKeyToAccount(w.key).address}\` | \`${w.funded}\` | \`${w.deposit}\` |`),
  "",
  "**Private withdrawals.** The relayer key `0x62BD…6613` sends each one, with no fee, to an address created for it. The proof shows only that the note is one of the pool's deposits, not which one.",
  "",
  ...state.wallets.flatMap((w) => (w.withdrawn ? [`- \`${w.withdrawn.tx}\` → \`${w.withdrawn.to}\` (0.1 MON)`] : [])),
  "",
  `**Stealth payment.** Wallet 1 paid 0.01 MON to a one-time stealth address of the deployer's registered meta-address: \`${state.stealth}\`.`,
  "",
  "**Limit.** The anonymity set is only as large as the pool's deposits. Every wallet here was funded by the same deployer, so a chain analyst can still group the depositors. Organic deposits are what make the set real.",
  "",
].join("\n");
writeFileSync(new URL("../docs/evidence/seed-13oct.md", import.meta.url), md);
process.exit(0);
