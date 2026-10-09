// bb.js logs progress with console.log; keep stdout clean for forge.
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
// Foundry FFI bridge for the shielded pool tests (packages/contracts/test/privacy).
// argv[2] = JSON, one of:
//   { mode: "hash", vectors: [[x...], ...] }
//       -> abi.encode(uint256[] zkpassport, uint256[] bbjs)   Poseidon2::hash(xs, xs.len()) per vector
//   { mode: "tree", leaves: [x...] }
//       -> abi.encode(uint256[] rootAfterEachInsert)
//   { mode: "prove", leaves: [x...], nullifier, secret, recipient, relayer, fee, refund, chainId, pool }
//       -> abi.encode(bytes32 root, bytes32 nullifierHash, bytes proof, bytes32[] publicInputs)
// all numbers are decimal strings; addresses are 0x hex.
import { encodeAbiParameters, type Hex } from "viem";
import { BarretenbergSync } from "@aztec/bb.js";
import { poseidon2 } from "../src/poseidon.ts";
import { PoolTree, withdrawInputs } from "../src/pool.ts";
import { prove } from "../src/prover.ts";

const spec = JSON.parse(process.argv[2]!) as Record<string, unknown>;
const big = (x: unknown) => BigInt(x as string);
const b32 = (x: bigint): Hex => `0x${x.toString(16).padStart(64, "0")}`;
let out: Hex;

if (spec.mode === "hash") {
  const vectors = (spec.vectors as string[][]).map((v) => v.map(big));
  const bb = await BarretenbergSync.initSingleton();
  const toBuf = (x: bigint) => Buffer.from(x.toString(16).padStart(64, "0"), "hex");
  const viaBb = vectors.map((v) => BigInt(`0x${Buffer.from(bb.poseidon2Hash({ inputs: v.map(toBuf) }).hash).toString("hex")}`));
  out = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], [vectors.map((v) => poseidon2(v)), viaBb]);
} else if (spec.mode === "tree") {
  const t = new PoolTree();
  const roots = (spec.leaves as string[]).map((l) => {
    t.insert(big(l));
    return t.root;
  });
  out = encodeAbiParameters([{ type: "uint256[]" }], [roots]);
} else if (spec.mode === "prove") {
  const tree = new PoolTree((spec.leaves as string[]).map(big));
  const { inputs, publicInputs } = withdrawInputs({
    note: { nullifier: big(spec.nullifier), secret: big(spec.secret) },
    tree,
    recipient: spec.recipient as Hex,
    relayer: spec.relayer as Hex,
    fee: big(spec.fee),
    refund: big(spec.refund),
    chainId: big(spec.chainId),
    pool: spec.pool as Hex,
  });
  const res = await prove("shielded_withdraw", inputs, 4);
  out = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }, { type: "bytes32[]" }],
    [b32(publicInputs[0]!), b32(publicInputs[1]!), res.proof, res.publicInputs],
  );
} else {
  throw new Error(`unknown mode ${String(spec.mode)}`);
}
process.stdout.write(out);
process.exit(0);
