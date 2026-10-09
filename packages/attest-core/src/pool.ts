// Shielded pool (KakushiPool) notes, tree and withdraw witness. Mirrors
// packages/zk/circuits/shielded_withdraw and packages/contracts/src/privacy/KakushiPool.sol.
//
// Encodings (all values are BN254 scalar field elements, < FIELD_MODULUS):
//   nullifier, secret     random field elements (31 random bytes each)
//   commitment            = Poseidon2::hash([nullifier, secret], 2)          (the tree leaf)
//   nullifierHash         = Poseidon2::hash([nullifier], 1)
//   tree                  incremental, depth 20, node = Poseidon2::hash([left, right], 2),
//                         empty leaf = keccak256("kakushi.pool.zero") mod p, leaves appended left to right
//   path bit i (LSB first) of leafIndex: 1 = the running node is the RIGHT child at level i
//   public inputs, in order:
//     [root, nullifierHash, recipient, relayer, fee, refund, chainId, pool]
//     recipient/relayer/pool = uint256(uint160(address)), fee/refund in token base units / wei,
//     chainId = block.chainid of the withdrawing chain, pool = the KakushiPool address.
import { keccak256, toBytes, type Hex } from "viem";
import { FIELD_MODULUS, hashPair, poseidon2 } from "./poseidon.ts";
import type { InputMap } from "./witness.ts";

export const POOL_DEPTH = 20;
export const POOL_CAPACITY = 1 << POOL_DEPTH;
export const POOL_ZERO_VALUE = BigInt(keccak256(toBytes("kakushi.pool.zero"))) % FIELD_MODULUS;

let ZEROS: bigint[] | undefined;
/** zeros[i] = empty subtree of height i; zeros[20] = root of the empty pool tree. */
export function poolZeros(): bigint[] {
  if (!ZEROS) {
    const z = [POOL_ZERO_VALUE];
    for (let i = 0; i < POOL_DEPTH; i++) z.push(hashPair(z[i]!, z[i]!));
    ZEROS = z;
  }
  return ZEROS;
}

export interface Note {
  nullifier: bigint;
  secret: bigint;
}

export const commitmentOf = (n: Note): bigint => poseidon2([n.nullifier, n.secret]);
export const nullifierHashOf = (nullifier: bigint): bigint => poseidon2([nullifier]);

/** A fresh note: 31 random bytes each, so both are canonical field elements. */
export function randomNote(): Note {
  const rand = (): bigint => {
    const b = new Uint8Array(31);
    crypto.getRandomValues(b);
    return BigInt(`0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`);
  };
  return { nullifier: rand(), secret: rand() };
}

/** Off-chain mirror of the on-chain incremental tree (rebuild it from Deposit events in leafIndex order). */
export class PoolTree {
  private readonly levels: bigint[][] = [[]];

  constructor(leaves: bigint[] = []) {
    for (let h = 1; h <= POOL_DEPTH; h++) this.levels.push([]);
    for (const l of leaves) this.insert(l);
  }

  get size(): number {
    return this.levels[0]!.length;
  }

  insert(leaf: bigint): number {
    if (leaf >= FIELD_MODULUS) throw new Error("leaf is not a field element");
    if (this.size >= POOL_CAPACITY) throw new Error("pool tree is full");
    const zeros = poolZeros();
    let idx = this.size;
    this.levels[0]!.push(leaf);
    let cur = leaf;
    for (let h = 0; h < POOL_DEPTH; h++) {
      const sib = idx & 1 ? this.levels[h]![idx - 1]! : zeros[h]!;
      cur = idx & 1 ? hashPair(sib, cur) : hashPair(cur, sib);
      idx >>= 1;
      this.levels[h + 1]![idx] = cur;
    }
    return this.size - 1;
  }

  get root(): bigint {
    return this.levels[POOL_DEPTH]![0] ?? poolZeros()[POOL_DEPTH]!;
  }

  path(index: number): { siblings: bigint[]; bits: boolean[] } {
    if (index < 0 || index >= this.size) throw new Error(`leaf ${index} not in tree`);
    const zeros = poolZeros();
    const siblings: bigint[] = [];
    const bits: boolean[] = [];
    let idx = index;
    for (let h = 0; h < POOL_DEPTH; h++) {
      siblings.push(this.levels[h]![idx ^ 1] ?? zeros[h]!);
      bits.push((idx & 1) === 1);
      idx >>= 1;
    }
    return { siblings, bits };
  }

  indexOf(commitment: bigint): number {
    return this.levels[0]!.indexOf(commitment);
  }
}

/** Mirror of the circuit's membership check. */
export function poolRoot(leaf: bigint, siblings: bigint[], bits: boolean[]): bigint {
  let cur = leaf;
  for (let h = 0; h < POOL_DEPTH; h++) cur = bits[h] ? hashPair(siblings[h]!, cur) : hashPair(cur, siblings[h]!);
  return cur;
}

export interface WithdrawRequest {
  note: Note;
  tree: PoolTree;
  recipient: Hex;
  relayer: Hex;
  fee: bigint;
  refund: bigint;
  chainId: bigint;
  pool: Hex;
}

const hx = (x: bigint): string => `0x${x.toString(16)}`;

/** Witness for shielded_withdraw plus the public inputs in verifier order. */
export function withdrawInputs(r: WithdrawRequest): { inputs: InputMap; publicInputs: bigint[] } {
  const commitment = commitmentOf(r.note);
  const index = r.tree.indexOf(commitment);
  if (index < 0) throw new Error("note commitment not in pool tree");
  const { siblings, bits } = r.tree.path(index);
  const publicInputs = [
    r.tree.root,
    nullifierHashOf(r.note.nullifier),
    BigInt(r.recipient),
    BigInt(r.relayer),
    r.fee,
    r.refund,
    r.chainId,
    BigInt(r.pool),
  ];
  const [root, nullifierHash, recipient, relayer, fee, refund, chainId, pool] = publicInputs.map(hx);
  return {
    inputs: {
      root: root!,
      nullifier_hash: nullifierHash!,
      recipient: recipient!,
      relayer: relayer!,
      fee: fee!,
      refund: refund!,
      chain_id: chainId!,
      pool: pool!,
      nullifier: hx(r.note.nullifier),
      secret: hx(r.note.secret),
      path: siblings.map(hx),
      path_bits: bits,
    },
    publicInputs,
  };
}
