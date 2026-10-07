// bb.js logs progress with console.log; keep stdout clean for forge.
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
// Foundry FFI bridge: build attested trees from leaf data and produce a REAL proof.
// argv[2] = JSON:
//   { circuit: "compliance"|"inclusion", ctx: {<DisputeContext fields as decimal strings>},
//     source: [leaf...], windows: [[leaf...], ...], inclusionWindow?: number }
//   leaf = [kind, chainId, srcRef, from, to, token, amount, recipient, blockNumber, timestamp] (decimal strings)
// stdout = hex of abi.encode(uint256 srcRoot, uint256[] payoutRoots, bytes proof)
import { encodeAbiParameters } from "viem";
import { SortedTree, complianceInputs, inclusionInputs, type DisputeContext, type Leaf } from "../src/index.ts";
import { prove } from "../src/prover.ts";

const spec = JSON.parse(process.argv[2]!) as {
  circuit: "compliance" | "inclusion";
  ctx: Record<string, string>;
  source: string[][];
  windows: string[][][];
  inclusionWindow?: number;
};
const toLeaf = (f: string[]): Leaf => {
  const [kind, chainId, srcRef, from, to, token, amount, recipient, blockNumber, timestamp] = f.map((x) => BigInt(x));
  return { kind: kind!, chainId: chainId!, srcRef: srcRef!, from: from!, to: to!, token: token!, amount: amount!, recipient: recipient!, blockNumber: blockNumber!, timestamp: timestamp! };
};
const ctx = Object.fromEntries(Object.entries(spec.ctx).map(([k, v]) => [k, BigInt(v)])) as unknown as DisputeContext;
const srcLeaves = spec.source.map(toLeaf);
const srcTree = new SortedTree(srcLeaves);
const srcLeaf = srcLeaves.find((l) => l.srcRef === ctx.srcRef);
if (!srcLeaf) throw new Error("ctx.srcRef not among source leaves");
const trees = spec.windows.map((w) => new SortedTree(w.map(toLeaf)));

let proofHex: `0x${string}` = "0x";
// When the witness is unsatisfiable (e.g. a Maker DID pay and we ask for an absence proof),
// we still return the roots and an empty proof, so tests can assert the dispute cannot proceed.
try {
  if (spec.circuit === "compliance") {
    const { inputs } = complianceInputs(ctx, srcTree, srcLeaf, trees);
    proofHex = (await prove("payment_compliance", inputs, 8)).proof;
  } else {
    const t = trees[spec.inclusionWindow ?? 0]!;
    const { inputs } = inclusionInputs(ctx, srcTree, srcLeaf, t);
    proofHex = (await prove("payout_inclusion", inputs, 8)).proof;
  }
} catch (e) {
  process.stderr.write(`proof not generated: ${(e as Error).message}\n`);
}
process.stdout.write(
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256[]" }, { type: "bytes" }],
    [srcTree.root, trees.map((t) => t.root), proofHex],
  ),
);
