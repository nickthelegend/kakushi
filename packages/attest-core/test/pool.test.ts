import { describe, expect, it } from "vitest";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { readFileSync } from "node:fs";
import {
  PoolTree, poolZeros, poolRoot, commitmentOf, nullifierHashOf, randomNote, withdrawInputs, POOL_DEPTH, POOL_ZERO_VALUE,
  FIELD_MODULUS, hashPair,
} from "../src/index.ts";

const note = { nullifier: 11n, secret: 22n };
const recipient = "0x00000000000000000000000000000000000000bb" as const;
const relayer = "0x00000000000000000000000000000000000000cc" as const;
const pool = "0xc0ffee254729296a45a3885639ac7e10f9d54979" as const;

describe("shielded pool", () => {
  it("zeros match PoolZeros.sol and the Noir test", () => {
    const z = poolZeros();
    expect(z).toHaveLength(POOL_DEPTH + 1);
    expect(z[0]).toBe(POOL_ZERO_VALUE);
    expect(z[0]).toBe(0x25b050981509767925e5c4a83dbd420549c32b744ac3ee76ed7e9d6fd2c0d8d4n);
    expect(z[20]).toBe(0x286a0baf08ac2d1d9f56281cafab9d2a32be3b0ba413f3b4902aacb0819e3757n);
    expect(new PoolTree().root).toBe(z[20]);
  });

  it("incremental root == root recomputed from every path", () => {
    const leaves = Array.from({ length: 9 }, (_, i) => hashPair(BigInt(i), 7n));
    const t = new PoolTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { siblings, bits } = t.path(i);
      expect(poolRoot(leaves[i]!, siblings, bits)).toBe(t.root);
    }
    expect(t.indexOf(leaves[4]!)).toBe(4);
    expect(() => t.insert(FIELD_MODULUS)).toThrow("not a field element");
  });

  it("notes are canonical field elements", () => {
    const n = randomNote();
    expect(n.nullifier < FIELD_MODULUS && n.secret < FIELD_MODULUS).toBe(true);
    expect(commitmentOf(n)).not.toBe(commitmentOf(randomNote()));
  });

  it("withdraw witness satisfies the circuit; public inputs in verifier order", async () => {
    const t = new PoolTree([5n, commitmentOf(note), 6n]);
    const { inputs, publicInputs } = withdrawInputs({ note, tree: t, recipient, relayer, fee: 3n, refund: 0n, chainId: 10143n, pool });
    expect(publicInputs).toEqual([t.root, nullifierHashOf(11n), 0xbbn, 0xccn, 3n, 0n, 10143n, BigInt(pool)]);
    const circuit = JSON.parse(readFileSync(new URL("../circuits/shielded_withdraw.json", import.meta.url), "utf8")) as CompiledCircuit;
    const { returnValue } = await new Noir(circuit).execute(inputs as never);
    expect(returnValue).toBeNull();
    await expect(new Noir(circuit).execute({ ...inputs, secret: "0x1" } as never)).rejects.toThrow();
    expect(() => withdrawInputs({ note: { nullifier: 1n, secret: 1n }, tree: t, recipient, relayer, fee: 0n, refund: 0n, chainId: 1n, pool })).toThrow("not in pool tree");
  });
});
