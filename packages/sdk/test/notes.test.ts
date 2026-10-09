import { describe, expect, it } from "vitest";
import { type Hex, createPublicClient, custom, encodeAbiParameters, encodeEventTopics, numberToHex, pad } from "viem";
import { PoolTree, poseidon2 } from "@kakushi/attest-core";
import {
  COMMITMENT_SCHEME,
  FIELD_MODULUS,
  IncrementalMerkleTree,
  POOL_EMPTY_LEAF,
  POOL_TREE_DEPTH,
  computeMerkleRoot,
  fieldToHex,
  generateNote,
  kakushiPoolAbi,
  noteCommitment,
  noteNullifierHash,
  parseNote,
  poolZeroValues,
  serializeNote,
} from "../src/index.ts";

const POOL = "0xc0ffee254729296a45a3885639AC7E10F9d54979" as Hex;

describe("notes", () => {
  it("random notes are field elements and round-trip through the note string", () => {
    for (let i = 0; i < 20; i++) {
      const n = generateNote(10143, POOL);
      expect(n.nullifier).toBeLessThan(FIELD_MODULUS);
      expect(n.secret).toBeLessThan(FIELD_MODULUS);
      const s = serializeNote(n);
      expect(s).toMatch(/^kakushi-note-v1-10143-0xc0ffee254729296a45a3885639ac7e10f9d54979-0x[0-9a-f]{64}-0x[0-9a-f]{64}$/);
      expect(parseNote(s)).toEqual(n);
    }
  });
  it("rejects malformed or out-of-field notes", () => {
    const n = serializeNote({ chainId: 1, pool: POOL, nullifier: 1n, secret: 2n });
    expect(() => parseNote(n.replace("v1", "v2"))).toThrow();
    expect(() => parseNote(n.slice(0, -1))).toThrow();
    expect(() => parseNote(n.replace(fieldToHex(2n), numberToHex(FIELD_MODULUS, { size: 32 })))).toThrow(/field/);
    expect(() => serializeNote({ chainId: 1, pool: POOL, nullifier: FIELD_MODULUS, secret: 1n })).toThrow();
  });
  it("commitment and nullifierHash are Poseidon2 (noir-lang/poseidon v0.4.0) of [n, s] and [n]", () => {
    expect(poseidon2([1n, 2n])).toBe(0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n);
    const n = { nullifier: 11n, secret: 22n };
    expect(noteCommitment(n)).toBe(poseidon2([11n, 22n]));
    expect(noteNullifierHash(n)).toBe(poseidon2([11n]));
    expect(COMMITMENT_SCHEME.commitment(1n, 2n)).toBe(poseidon2([1n, 2n]));
  });
});

describe("pool tree", () => {
  it("zero values match PoolZeros.sol (keccak256('kakushi.pool.zero') mod p, then Poseidon2 pairs)", () => {
    const z = poolZeroValues();
    expect(z).toHaveLength(POOL_TREE_DEPTH + 1);
    expect(z[0]).toBe(POOL_EMPTY_LEAF);
    expect(fieldToHex(z[0]!)).toBe("0x25b050981509767925e5c4a83dbd420549c32b744ac3ee76ed7e9d6fd2c0d8d4");
    for (let i = 0; i < POOL_TREE_DEPTH; i++) expect(z[i + 1]).toBe(poseidon2([z[i]!, z[i]!]));
    expect(fieldToHex(z[20]!)).toBe("0x286a0baf08ac2d1d9f56281cafab9d2a32be3b0ba413f3b4902aacb0819e3757");
    expect(new IncrementalMerkleTree().root).toBe(z[20]);
  });
  it("paths verify for every leaf and roots match attest-core's PoolTree", () => {
    const leaves = Array.from({ length: 9 }, (_, i) => noteCommitment({ nullifier: BigInt(i + 1), secret: BigInt(100 + i) }));
    const t = new IncrementalMerkleTree();
    const roots: bigint[] = [];
    for (const l of leaves) {
      t.insert(l);
      roots.push(t.root);
    }
    expect(new Set(roots).size).toBe(leaves.length);
    expect(t.root).toBe(new PoolTree(leaves).root);
    for (let i = 0; i < leaves.length; i++) {
      const p = t.path(i);
      expect(p.leaf).toBe(leaves[i]);
      expect(p.pathElements).toHaveLength(20);
      expect(p.pathIndices.slice(0, 4)).toEqual([!!(i & 1), !!(i & 2), !!(i & 4), !!(i & 8)]);
      expect(computeMerkleRoot(p.leaf, p.pathElements, p.pathIndices)).toBe(t.root);
    }
    expect(t.pathForNote({ nullifier: 3n, secret: 102n }).leafIndex).toBe(2);
    expect(() => t.pathForNote({ nullifier: 3n, secret: 1n })).toThrow(/not in the pool tree/);
    expect(() => t.path(9)).toThrow();
  });

  it("rebuilds from Deposit events across log chunks, in leafIndex order", async () => {
    const leaves = Array.from({ length: 5 }, (_, i) => poseidon2([BigInt(i + 7)]));
    const deposit = kakushiPoolAbi.find((x) => x.type === "event" && x.name === "Deposit")!;
    const blocks = [10n, 10n, 150n, 151n, 260n];
    const log = (i: number) => ({
      address: POOL,
      topics: encodeEventTopics({ abi: [deposit], eventName: "Deposit", args: { commitment: fieldToHex(leaves[i]!) } }),
      data: encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }], [i, 1_800_000_000n]),
      blockNumber: numberToHex(blocks[i]!),
      transactionHash: pad(numberToHex(i + 1), { size: 32 }),
      transactionIndex: "0x0",
      blockHash: pad("0x01", { size: 32 }),
      logIndex: numberToHex(i),
      removed: false,
    });
    // the node returns the two logs of block 10 in reverse order
    const all = [log(1), log(0), log(2), log(3), log(4)];
    let calls = 0;
    const client = createPublicClient({
      transport: custom({
        request: async ({ method, params }: { method: string; params: any[] }) => {
          if (method === "eth_blockNumber") return "0x12c"; // 300
          if (method !== "eth_getLogs") throw new Error(method);
          calls++;
          const from = BigInt(params[0].fromBlock);
          const to = BigInt(params[0].toBlock);
          expect(to - from).toBeLessThan(100n);
          return all.filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
        },
      }),
    });
    const t = await IncrementalMerkleTree.fromDeposits(client as any, POOL, 0n);
    expect(calls).toBe(4);
    expect(t.leaves).toEqual(leaves);
    expect(t.root).toBe(new IncrementalMerkleTree(leaves).root);

    // a gap (scan started after the first deposit) is an error, not a wrong root
    await expect(IncrementalMerkleTree.fromDeposits(client as any, POOL, 100n, 300n)).rejects.toThrow(/deposit 0 missing/);
  });
});
