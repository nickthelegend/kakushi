// Shielded-pool notes and the pool's incremental Merkle tree, for apps and wallets.
//
// The cryptographic definitions are NOT repeated here: they live in @kakushi/attest-core
// (src/pool.ts), which mirrors packages/zk/circuits/shielded_withdraw and is what
// packages/contracts/src/privacy/PoolZeros.sol is generated from. This module adds the note
// string format, Deposit-event tree rebuild and path helpers on top.
//
// Hash: Poseidon2 over BN254 exactly as noir-lang/poseidon v0.4.0 `Poseidon2::hash(input, len)`
// (@zkpassport/poseidon2). Vector: Poseidon2([1, 2]) =
// 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383.
import { type Hex, type PublicClient, getAddress, isAddress, numberToHex } from "viem";
import { FIELD_MODULUS, POOL_DEPTH, POOL_ZERO_VALUE, PoolTree, commitmentOf, nullifierHashOf, poolRoot, poolZeros, randomNote } from "@kakushi/attest-core";
import { kakushiPoolAbi } from "./pool-abi.ts";

export { FIELD_MODULUS };

/**
 * The note commitment scheme: the one switch the SDK reads. It MUST match the withdraw circuit
 * (packages/zk/circuits/shielded_withdraw: commitment_of / nullifier_hash_of):
 *   commitment    = Poseidon2::hash([nullifier, secret], 2)
 *   nullifierHash = Poseidon2::hash([nullifier], 1)
 */
export const COMMITMENT_SCHEME = {
  commitment: (nullifier: bigint, secret: bigint): bigint => commitmentOf({ nullifier, secret }),
  nullifierHash: (nullifier: bigint): bigint => nullifierHashOf(nullifier),
} as const;

/** Tree depth shared with the circuit (DEPTH) and KakushiPool. */
export const POOL_TREE_DEPTH = POOL_DEPTH;

/**
 * The pool tree's empty-subtree values, exactly what PoolZeros.sol hard-codes:
 *   zero[0]   = uint256(keccak256("kakushi.pool.zero")) mod p      (the empty leaf, POOL_EMPTY_LEAF)
 *   zero[i+1] = Poseidon2::hash([zero[i], zero[i]], 2)
 * zero[20] is the root of the empty tree. Internal node = Poseidon2::hash([left, right], 2).
 */
export const POOL_EMPTY_LEAF = POOL_ZERO_VALUE;
export function poolZeroValues(): readonly bigint[] {
  return poolZeros();
}

export interface Note {
  chainId: number;
  pool: Hex;
  nullifier: bigint;
  secret: bigint;
}

/** Fresh note: nullifier and secret are 31 random bytes each (always canonical field elements). */
export function generateNote(chainId: number, pool: Hex): Note {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`bad chainId ${chainId}`);
  if (!isAddress(pool, { strict: false })) throw new Error(`bad pool address ${pool}`);
  const { nullifier, secret } = randomNote();
  return { chainId, pool: getAddress(pool), nullifier, secret };
}

/** Field element as bytes32 hex (big-endian): the on-chain and note-string encoding. */
export function fieldToHex(x: bigint): Hex {
  if (x < 0n || x >= FIELD_MODULUS) throw new Error(`not a BN254 field element: ${x}`);
  return numberToHex(x, { size: 32 });
}

export function noteCommitment(n: Pick<Note, "nullifier" | "secret">): bigint {
  return COMMITMENT_SCHEME.commitment(n.nullifier, n.secret);
}

export function noteNullifierHash(n: Pick<Note, "nullifier">): bigint {
  return COMMITMENT_SCHEME.nullifierHash(n.nullifier);
}

/** `kakushi-note-v1-<chainId decimal>-<pool, lowercase>-<nullifier bytes32>-<secret bytes32>` */
export function serializeNote(n: Note): string {
  if (!Number.isSafeInteger(n.chainId) || n.chainId <= 0) throw new Error(`bad chainId ${n.chainId}`);
  if (!isAddress(n.pool, { strict: false })) throw new Error(`bad pool address ${n.pool}`);
  return `kakushi-note-v1-${n.chainId}-${n.pool.toLowerCase()}-${fieldToHex(n.nullifier)}-${fieldToHex(n.secret)}`;
}

export function parseNote(s: string): Note {
  const m = /^kakushi-note-v1-(\d{1,15})-(0x[0-9a-fA-F]{40})-(0x[0-9a-fA-F]{64})-(0x[0-9a-fA-F]{64})$/.exec(s.trim());
  if (!m) throw new Error("not a kakushi-note-v1 string");
  const chainId = Number(m[1]);
  const nullifier = BigInt(m[3]!);
  const secret = BigInt(m[4]!);
  if (chainId <= 0) throw new Error("note chainId must be positive");
  if (nullifier >= FIELD_MODULUS || secret >= FIELD_MODULUS) throw new Error("note values must be BN254 field elements");
  return { chainId, pool: getAddress(m[2]!), nullifier, secret };
}

// ------------------------------------------------------------------ Merkle tree

export interface MerklePath {
  leaf: bigint;
  leafIndex: number;
  root: bigint;
  /** sibling at each level, leaf level first (the circuit's `path`) */
  pathElements: bigint[];
  /** bit i of leafIndex, LSB first: true = the running node is the RIGHT child (`path_bits`) */
  pathIndices: boolean[];
}

/** Append-only depth-20 Poseidon2 tree mirroring KakushiPool (wraps attest-core's PoolTree). */
export class IncrementalMerkleTree {
  readonly depth = POOL_TREE_DEPTH;
  readonly tree: PoolTree;
  private readonly _leaves: bigint[] = [];

  constructor(leaves: bigint[] = []) {
    this.tree = new PoolTree();
    for (const l of leaves) this.insert(l);
  }

  get size(): number {
    return this.tree.size;
  }

  get root(): bigint {
    return this.tree.root;
  }

  get leaves(): readonly bigint[] {
    return this._leaves;
  }

  insert(leaf: bigint): number {
    if (leaf < 0n) throw new Error("leaf is not a field element");
    const i = this.tree.insert(leaf);
    this._leaves.push(leaf);
    return i;
  }

  indexOf(leaf: bigint): number {
    return this.tree.indexOf(leaf);
  }

  path(leafIndex: number): MerklePath {
    if (!Number.isInteger(leafIndex)) throw new Error(`bad leaf index ${leafIndex}`);
    const { siblings, bits } = this.tree.path(leafIndex);
    return { leaf: this._leaves[leafIndex]!, leafIndex, root: this.root, pathElements: siblings, pathIndices: bits };
  }

  /** Path for a note's commitment, or throws if the note was never deposited. */
  pathForNote(n: Pick<Note, "nullifier" | "secret">): MerklePath {
    const i = this.indexOf(noteCommitment(n));
    if (i < 0) throw new Error("note commitment is not in the pool tree");
    return this.path(i);
  }

  /**
   * Rebuild from the pool's Deposit events, paging eth_getLogs in `chunk`-block ranges (Monad's
   * public RPC refuses more than 100). Leaves must be 0..n-1 with no gaps, so start at the pool's
   * deploy block.
   */
  static async fromDeposits(client: PublicClient, pool: Hex, fromBlock: bigint, toBlock?: bigint, opts: { chunk?: bigint } = {}): Promise<IncrementalMerkleTree> {
    const chunk = opts.chunk ?? 100n;
    if (chunk < 1n) throw new Error("chunk must be positive");
    const end = toBlock ?? (await client.getBlockNumber());
    const event = kakushiPoolAbi.find((x) => x.type === "event" && x.name === "Deposit")!;
    const byIndex = new Map<number, bigint>();
    for (let from = fromBlock; from <= end; from += chunk) {
      const to = from + chunk - 1n > end ? end : from + chunk - 1n;
      const logs = await client.getLogs({ address: pool, event, fromBlock: from, toBlock: to });
      for (const l of logs) {
        const { commitment, leafIndex } = l.args as { commitment?: Hex; leafIndex?: number };
        if (commitment === undefined || leafIndex === undefined) continue;
        const prev = byIndex.get(leafIndex);
        if (prev !== undefined && prev !== BigInt(commitment)) throw new Error(`conflicting deposits at leaf ${leafIndex}`);
        byIndex.set(leafIndex, BigInt(commitment));
      }
    }
    const tree = new IncrementalMerkleTree();
    for (let i = 0; i < byIndex.size; i++) {
      const c = byIndex.get(i);
      if (c === undefined) throw new Error(`deposit ${i} missing: scan from the pool's deploy block`);
      tree.insert(c);
    }
    return tree;
  }
}

/** Recompute the root from a leaf and its path (the circuit's compute_root). */
export function computeMerkleRoot(leaf: bigint, pathElements: bigint[], pathIndices: boolean[]): bigint {
  if (pathElements.length !== POOL_TREE_DEPTH || pathIndices.length !== POOL_TREE_DEPTH) throw new Error(`path must have ${POOL_TREE_DEPTH} levels`);
  return poolRoot(leaf, pathElements, pathIndices);
}
