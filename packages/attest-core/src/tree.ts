import { FIELD_MODULUS, hashPair } from "./poseidon.ts";
import { type Leaf, leafDataHash, leafKey, nodeHash } from "./leaf.ts";

export const DEPTH = 12;
export const CAPACITY = 1 << DEPTH;
export const LOW_SENTINEL_KEY = 0n;
export const HIGH_SENTINEL_KEY = FIELD_MODULUS - 1n;

export interface TreeEntry {
  key: bigint;
  data: bigint;
  leaf?: Leaf;
}

let ZEROS: bigint[] | undefined;
/** zeros[i] = value of an empty subtree of height i (empty leaf slot = 0). */
export function zeroHashes(): bigint[] {
  if (!ZEROS) {
    const z: bigint[] = [0n];
    for (let i = 0; i < DEPTH; i++) z.push(hashPair(z[i]!, z[i]!));
    ZEROS = z;
  }
  return ZEROS;
}

/**
 * A sorted Poseidon2 Merkle tree of depth 12 (PLAN.md §4.3 / §7.5).
 * Leaves are sorted by key and framed by sentinels (key 0 and key p-1), so the absence of a
 * key is proven by two adjacent leaves that bracket it. Leaf node = H(key, H(leaf fields)).
 * Empty slots after the last sentinel are 0.
 */
export class SortedTree {
  readonly entries: TreeEntry[];
  readonly levels: bigint[][];
  readonly root: bigint;

  constructor(leaves: Leaf[]) {
    const real: TreeEntry[] = leaves.map((l) => ({ key: leafKey(l), data: leafDataHash(l), leaf: l }));
    real.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (let i = 1; i < real.length; i++) {
      if (real[i]!.key === real[i - 1]!.key) throw new Error(`duplicate leaf key ${real[i]!.key}`);
    }
    for (const e of real) {
      if (e.key === LOW_SENTINEL_KEY || e.key === HIGH_SENTINEL_KEY) throw new Error("leaf key collides with a sentinel");
    }
    this.entries = [{ key: LOW_SENTINEL_KEY, data: 0n }, ...real, { key: HIGH_SENTINEL_KEY, data: 0n }];
    if (this.entries.length > CAPACITY) throw new Error(`window has ${this.entries.length} entries, capacity ${CAPACITY}`);

    const zeros = zeroHashes();
    const levels: bigint[][] = [this.entries.map((e) => nodeHash(e.key, e.data))];
    for (let h = 0; h < DEPTH; h++) {
      const cur = levels[h]!;
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashPair(cur[i]!, cur[i + 1] ?? zeros[h]!));
      }
      levels.push(next);
    }
    this.levels = levels;
    this.root = levels[DEPTH]![0]!;
  }

  /** number of real (non-sentinel) leaves */
  get leafCount(): number {
    return this.entries.length - 2;
  }

  path(index: number): bigint[] {
    const zeros = zeroHashes();
    const out: bigint[] = [];
    let idx = index;
    for (let h = 0; h < DEPTH; h++) {
      out.push(this.levels[h]![idx ^ 1] ?? zeros[h]!);
      idx >>= 1;
    }
    return out;
  }

  indexOf(key: bigint): number {
    return this.entries.findIndex((e) => e.key === key);
  }

  /** Adjacent entries bracketing `key`, or undefined if `key` is present. */
  absence(key: bigint): { lowIndex: number; low: TreeEntry; high: TreeEntry } | undefined {
    for (let i = 0; i + 1 < this.entries.length; i++) {
      const low = this.entries[i]!;
      const high = this.entries[i + 1]!;
      if (low.key < key && key < high.key) return { lowIndex: i, low, high };
      if (low.key === key || high.key === key) return undefined;
    }
    return undefined;
  }
}

/** Recompute a root from a leaf node and path (mirror of kakushi_lib::compute_root). */
export function computeRoot(leafNode: bigint, index: number, path: bigint[]): bigint {
  let cur = leafNode;
  let idx = index;
  for (let h = 0; h < DEPTH; h++) {
    cur = idx & 1 ? hashPair(path[h]!, cur) : hashPair(cur, path[h]!);
    idx >>= 1;
  }
  return cur;
}
