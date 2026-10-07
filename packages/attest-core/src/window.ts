import { type Leaf } from "./leaf.ts";
import { SortedTree } from "./tree.ts";

export const WINDOW_SOURCE = 1;
export const WINDOW_PAYOUT = 2;

/** Mirrors AttestationOracle.Window (Solidity) field for field. */
export interface AttestWindow {
  chainId: bigint;
  kind: number;
  fromBlock: bigint;
  toBlock: bigint;
  fromTime: bigint;
  toTime: bigint;
  root: bigint;
  leafCount: number;
}

export interface BuiltWindow {
  window: AttestWindow;
  tree: SortedTree;
}

export function buildWindow(args: {
  chainId: number | bigint;
  kind: number;
  fromBlock: bigint;
  toBlock: bigint;
  fromTime: bigint;
  toTime: bigint;
  leaves: Leaf[];
}): BuiltWindow {
  if (args.toBlock < args.fromBlock) throw new Error("toBlock < fromBlock");
  const tree = new SortedTree(args.leaves);
  return {
    tree,
    window: {
      chainId: BigInt(args.chainId),
      kind: args.kind,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
      fromTime: args.fromTime,
      toTime: args.toTime,
      root: tree.root,
      leafCount: tree.leafCount,
    },
  };
}

/** ABI type of AttestationOracle.onReport's report: abi.encode(Window[]). */
export const WINDOW_ABI_TYPE = {
  type: "tuple[]",
  components: [
    { name: "chainId", type: "uint64" },
    { name: "kind", type: "uint8" },
    { name: "fromBlock", type: "uint64" },
    { name: "toBlock", type: "uint64" },
    { name: "fromTime", type: "uint64" },
    { name: "toTime", type: "uint64" },
    { name: "root", type: "uint256" },
    { name: "leafCount", type: "uint32" },
  ],
} as const;
