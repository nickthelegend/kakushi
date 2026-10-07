import { type Leaf, payoutKey } from "./leaf.ts";
import { DEPTH, SortedTree } from "./tree.ts";

export const MAX_WINDOWS = 8;
export const MODE_FILL = 1n;
export const MODE_REFUND = 2n;

/** Public facts of a dispute, in circuit order (PLAN.md §7.5, DisputeModule._fillCommon). */
export interface DisputeContext {
  domain: bigint;
  srcChainId: bigint;
  obligationChainId: bigint;
  srcRef: bigint;
  maker: bigint;
  sender: bigint;
  recipient: bigint; // payout recipient: dst recipient (FILL) or sender (REFUND)
  srcToken: bigint;
  payToken: bigint;
  gross: bigint;
  identCode: bigint;
  withholding: bigint;
  bps: bigint;
  expected: bigint;
  mode: bigint;
  srcTimestamp: bigint;
  deadline: bigint;
}

type InputValue = string | boolean | InputValue[] | { [k: string]: InputValue };
export type InputMap = { [k: string]: InputValue };

const hex = (x: bigint): string => `0x${x.toString(16)}`;

function leafInput(l: Leaf): InputMap {
  return {
    kind: hex(l.kind),
    chain_id: hex(l.chainId),
    src_ref: hex(l.srcRef),
    from: hex(l.from),
    to: hex(l.to),
    token: hex(l.token),
    amount: hex(l.amount),
    recipient: hex(l.recipient),
    block_number: hex(l.blockNumber),
    timestamp: hex(l.timestamp),
  };
}

const ZERO_LEAF: Leaf = {
  kind: 0n,
  chainId: 0n,
  srcRef: 0n,
  from: 0n,
  to: 0n,
  token: 0n,
  amount: 0n,
  recipient: 0n,
  blockNumber: 0n,
  timestamp: 0n,
};
const zeroPath = (): string[] => Array.from({ length: DEPTH }, () => "0x0");

export function commonPublic(ctx: DisputeContext): bigint[] {
  return [
    ctx.domain,
    ctx.srcChainId,
    ctx.obligationChainId,
    ctx.srcRef,
    ctx.maker,
    ctx.sender,
    ctx.recipient,
    ctx.srcToken,
    ctx.payToken,
    ctx.gross,
    ctx.identCode,
    ctx.withholding,
    ctx.bps,
    ctx.expected,
    ctx.mode,
    ctx.srcTimestamp,
    ctx.deadline,
  ];
}

function commonInputs(ctx: DisputeContext, srcTree: SortedTree, srcLeaf: Leaf): InputMap {
  const idx = srcTree.indexOf(srcLeaf.srcRef);
  if (idx < 0) throw new Error("source leaf not in source tree");
  return {
    domain: hex(ctx.domain),
    src_chain_id: hex(ctx.srcChainId),
    obligation_chain_id: hex(ctx.obligationChainId),
    src_ref: hex(ctx.srcRef),
    maker: hex(ctx.maker),
    sender: hex(ctx.sender),
    recipient: hex(ctx.recipient),
    src_token: hex(ctx.srcToken),
    pay_token: hex(ctx.payToken),
    gross: hex(ctx.gross),
    ident_code: hex(ctx.identCode),
    withholding: hex(ctx.withholding),
    bps: hex(ctx.bps),
    expected: hex(ctx.expected),
    mode: hex(ctx.mode),
    src_timestamp: hex(ctx.srcTimestamp),
    deadline: hex(ctx.deadline),
    src_root: hex(srcTree.root),
    src_leaf: leafInput(srcLeaf),
    src_index: hex(BigInt(idx)),
    src_path: srcTree.path(idx).map(hex),
  };
}

/** Witness for PaymentCompliance: absence (or a non-compliant payout) in every window. */
export function complianceInputs(
  ctx: DisputeContext,
  srcTree: SortedTree,
  srcLeaf: Leaf,
  payoutTrees: SortedTree[],
): { inputs: InputMap; publicInputs: bigint[] } {
  if (payoutTrees.length < 1 || payoutTrees.length > MAX_WINDOWS) throw new Error("1..8 payout windows required");
  const key = payoutKey(ctx.srcRef, ctx.maker);
  const windows: InputMap[] = [];
  const roots: bigint[] = [];
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const t = payoutTrees[i];
    if (!t) {
      roots.push(0n);
      windows.push(emptyWindow());
      continue;
    }
    roots.push(t.root);
    const idx = t.indexOf(key);
    if (idx >= 0) {
      const leaf = t.entries[idx]!.leaf!;
      windows.push({
        ...emptyWindow(),
        present: true,
        leaf: leafInput(leaf),
        leaf_index: hex(BigInt(idx)),
        leaf_path: t.path(idx).map(hex),
      });
    } else {
      const a = t.absence(key);
      if (!a) throw new Error("no absence witness");
      windows.push({
        ...emptyWindow(),
        present: false,
        low_key: hex(a.low.key),
        low_data: hex(a.low.data),
        high_key: hex(a.high.key),
        high_data: hex(a.high.data),
        low_index: hex(BigInt(a.lowIndex)),
        low_path: t.path(a.lowIndex).map(hex),
        high_path: t.path(a.lowIndex + 1).map(hex),
      });
    }
  }
  const inputs: InputMap = {
    ...commonInputs(ctx, srcTree, srcLeaf),
    window_count: hex(BigInt(payoutTrees.length)),
    payout_roots: roots.map(hex),
    windows,
  };
  const publicInputs = [...commonPublic(ctx), srcTree.root, BigInt(payoutTrees.length), ...roots];
  return { inputs, publicInputs };
}

function emptyWindow(): InputMap {
  return {
    present: false,
    low_key: "0x0",
    low_data: "0x0",
    high_key: "0x0",
    high_data: "0x0",
    low_index: "0x0",
    low_path: zeroPath(),
    high_path: zeroPath(),
    leaf: leafInput(ZERO_LEAF),
    leaf_index: "0x0",
    leaf_path: zeroPath(),
  };
}

/** Witness for PayoutInclusion: the Maker's compliant payout is in `payoutTree`. */
export function inclusionInputs(
  ctx: DisputeContext,
  srcTree: SortedTree,
  srcLeaf: Leaf,
  payoutTree: SortedTree,
): { inputs: InputMap; publicInputs: bigint[] } {
  const key = payoutKey(ctx.srcRef, ctx.maker);
  const idx = payoutTree.indexOf(key);
  if (idx < 0) throw new Error("payout not in window");
  const leaf = payoutTree.entries[idx]!.leaf!;
  const inputs: InputMap = {
    ...commonInputs(ctx, srcTree, srcLeaf),
    payout_root: hex(payoutTree.root),
    payout_leaf: leafInput(leaf),
    payout_index: hex(BigInt(idx)),
    payout_path: payoutTree.path(idx).map(hex),
  };
  const publicInputs = [...commonPublic(ctx), srcTree.root, payoutTree.root];
  return { inputs, publicInputs };
}
