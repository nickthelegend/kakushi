import { encodeAbiParameters, keccak256 } from "viem";
import { poseidon2 } from "./poseidon.ts";

export const LEAF_SOURCE = 1n;
export const LEAF_PAYOUT_FILL = 2n;
export const LEAF_PAYOUT_REFUND = 3n;
export const NATIVE_LOG_INDEX = 0xffffffff;

/** A normalized, attested payment record. Field order is normative (PLAN.md §7.5). */
export interface Leaf {
  kind: bigint;
  chainId: bigint;
  srcRef: bigint;
  from: bigint;
  to: bigint;
  token: bigint;
  amount: bigint;
  recipient: bigint;
  blockNumber: bigint;
  timestamp: bigint;
}

export function leafFields(l: Leaf): bigint[] {
  return [l.kind, l.chainId, l.srcRef, l.from, l.to, l.token, l.amount, l.recipient, l.blockNumber, l.timestamp];
}

export function leafDataHash(l: Leaf): bigint {
  return poseidon2(leafFields(l));
}

export function payoutKey(srcRef: bigint, maker: bigint): bigint {
  return poseidon2([srcRef, maker]);
}

/** Source leaves are keyed by srcRef; payout leaves by H(srcRef, maker). */
export function leafKey(l: Leaf): bigint {
  return l.kind === LEAF_SOURCE ? l.srcRef : payoutKey(l.srcRef, l.from);
}

export function nodeHash(key: bigint, data: bigint): bigint {
  return poseidon2([key, data]);
}

export function leafNode(l: Leaf): bigint {
  return nodeHash(leafKey(l), leafDataHash(l));
}

/** srcRef = keccak256(abi.encode(uint64 chainId, bytes32 txHash, uint32 logIndex)) >> 8 (SrcRef.sol). */
export function computeSrcRef(chainId: number | bigint, txHash: `0x${string}`, logIndex: number): bigint {
  const enc = encodeAbiParameters(
    [{ type: "uint64" }, { type: "bytes32" }, { type: "uint32" }],
    [BigInt(chainId), txHash, logIndex],
  );
  return BigInt(keccak256(enc)) >> 8n;
}

export function addr(a: string): bigint {
  return BigInt(a);
}

export function toHex32(x: bigint): `0x${string}` {
  return `0x${x.toString(16).padStart(64, "0")}`;
}

export interface SourceInput {
  chainId: number;
  txHash: `0x${string}`;
  logIndex: number; // NATIVE_LOG_INDEX for native transfers
  sender: string;
  maker: string;
  token: string; // zero address = native
  amount: bigint;
  recipient: string; // = sender on the raw path
  blockNumber: bigint;
  timestamp: bigint;
}

export function sourceLeaf(s: SourceInput): Leaf {
  return {
    kind: LEAF_SOURCE,
    chainId: BigInt(s.chainId),
    srcRef: computeSrcRef(s.chainId, s.txHash, s.logIndex),
    from: addr(s.sender),
    to: addr(s.maker),
    token: addr(s.token),
    amount: s.amount,
    recipient: addr(s.recipient),
    blockNumber: s.blockNumber,
    timestamp: s.timestamp,
  };
}

export interface PayoutInput {
  chainId: number;
  srcRef: bigint;
  maker: string;
  recipient: string;
  token: string;
  amount: bigint;
  kind: 2 | 3;
  blockNumber: bigint;
  timestamp: bigint;
}

export function payoutLeaf(p: PayoutInput): Leaf {
  return {
    kind: BigInt(p.kind),
    chainId: BigInt(p.chainId),
    srcRef: p.srcRef,
    from: addr(p.maker),
    to: addr(p.recipient),
    token: addr(p.token),
    amount: p.amount,
    recipient: addr(p.recipient),
    blockNumber: p.blockNumber,
    timestamp: p.timestamp,
  };
}
