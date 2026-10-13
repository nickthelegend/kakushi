// Live gasless-withdraw smoke test: shield on Sepolia, then withdraw to a brand-new address through
// the hosted relayer, reached the way the app reaches it (the app's /api/svc/relayer proxy).
//
//   set -a; . ./.env.testnet; set +a; node scripts/smoke-relay-testnet.ts [--app https://kakushi.vercel.app]
//
// The deployer (DEPLOYER_PK, never printed) deposits into the Sepolia ETH pool, proves the
// withdrawal here with the relayer and its quoted fee bound in the proof, and POSTs it to the
// relayer. The fresh address never holds gas: it ends with the denomination minus the fee, and the
// relayer's own key pays the transaction. Evidence goes to docs/evidence/testnet-relay.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, formatEther, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "@kakushi/config";
import { IncrementalMerkleTree, fieldToHex, generateNote, noteCommitment, noteNullifierHash, publicClient, walletClient } from "@kakushi/sdk";
import { prove } from "@kakushi/attest-core/prover";

const pk = process.env.DEPLOYER_PK as Hex | undefined;
if (!pk) throw new Error("DEPLOYER_PK not set (source the gitignored .env.testnet)");
const me = privateKeyToAccount(pk);
const i = process.argv.indexOf("--app");
const APP = (i > 0 ? process.argv[i + 1]! : "https://kakushi.vercel.app").replace(/\/$/, "");
const chain = CHAINS.sepolia;
const dep = JSON.parse(readFileSync(new URL("../config/generated/deployments.testnet.json", import.meta.url), "utf8"));
const priv = dep.chains[String(chain.chainId)].privacy;
const pool = Object.values(priv.pools as Record<string, { address: Hex; token: Hex; denomination: string }>).find((p) => /^0x0{40}$/i.test(p.token));
if (!pool) throw new Error("no native pool on Sepolia");
const pc = publicClient("sepolia", "testnet");
const w = walletClient("sepolia", pk, "testnet");
const poolAbi = parseAbi(["function deposit(bytes32 commitment) payable"]);

const info = (await (await fetch(`${APP}/api/svc/relayer/info`)).json()) as { address: Hex; feeByPool: Record<string, Record<string, string>> };
const fee = BigInt(info.feeByPool[String(chain.chainId)]?.[pool.address] ?? "-1");
if (fee < 0n) throw new Error("the relayer does not quote this pool");
console.log(`relayer ${info.address} quotes ${formatEther(fee)} ETH for the ${formatEther(BigInt(pool.denomination))} ETH pool ${pool.address}`);

// 1. shield
const note = generateNote(chain.chainId, pool.address);
const data = encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [fieldToHex(noteCommitment(note))] });
const depHash = await w.sendTransaction({ chain: w.chain, account: me, to: pool.address, data, value: BigInt(pool.denomination) });
await pc.waitForTransactionReceipt({ hash: depHash });
console.log(`PASS  shield ${formatEther(BigInt(pool.denomination))} ETH: ${depHash}`);

// 2. prove with the relayer and fee bound in, then relay through the app
const fresh = privateKeyToAccount(generatePrivateKey()).address;
const tree = await IncrementalMerkleTree.fromDeposits(pc, pool.address, BigInt(priv.deployBlock));
const path = tree.pathForNote(note);
const hx = (x: bigint) => `0x${x.toString(16)}`;
const t0 = Date.now();
const proof = await prove("shielded_withdraw", {
  root: hx(path.root), nullifier_hash: hx(noteNullifierHash(note)), recipient: hx(BigInt(fresh)), relayer: hx(BigInt(info.address)), fee: hx(fee), refund: "0x0",
  chain_id: hx(BigInt(chain.chainId)), pool: hx(BigInt(pool.address)), ext_data_hash: "0x0", nullifier: hx(note.nullifier), secret: hx(note.secret), path: path.pathElements.map(hx), path_bits: path.pathIndices,
});
const proofMs = Date.now() - t0;
const args = { root: fieldToHex(path.root), nullifierHash: fieldToHex(noteNullifierHash(note)), recipient: fresh, relayer: info.address, fee: fee.toString(), refund: "0" };
const r = await fetch(`${APP}/api/svc/relayer/relay`, { method: "POST", body: JSON.stringify({ chainId: chain.chainId, pool: pool.address, proof: proof.proof, args }) });
const j = (await r.json()) as { txHash?: Hex; error?: string };
if (!r.ok || !j.txHash) throw new Error(`relay refused (${r.status}): ${j.error}`);
const rc = await pc.waitForTransactionReceipt({ hash: j.txHash });
const got = await pc.getBalance({ address: fresh });
const ok = rc.status === "success" && got === BigInt(pool.denomination) - fee && rc.from.toLowerCase() === info.address.toLowerCase();
console.log(`${ok ? "PASS" : "FAIL"}  gasless withdraw (proof ${proofMs} ms) sent by the relayer ${rc.from}: ${j.txHash}; fresh ${fresh} holds ${formatEther(got)} ETH`);

mkdirSync(new URL("../docs/evidence/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../docs/evidence/testnet-relay.json", import.meta.url),
  JSON.stringify({ at: new Date().toISOString(), chainId: chain.chainId, app: APP, pool: pool.address, relayer: info.address, fee: fee.toString(), depositTx: depHash, withdrawTx: j.txHash, sentBy: rc.from, fresh, received: got.toString(), proofMs, pass: ok }, null, 2),
);
process.exit(ok ? 0 : 1);
