// The attestation logic shared by the Chainlink CRE workflow (packages/cre) and the local
// Node runner. Pure functions over fetched chain data, so both produce byte-identical
// windows and reports. PLAN.md §5.6 / §7.4 / §7.5.
import { decodeAbiParameters, encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { type Leaf, payoutLeaf, sourceLeaf, NATIVE_LOG_INDEX } from "./leaf.ts";
import { buildWindow, type AttestWindow, type BuiltWindow, WINDOW_ABI_TYPE, WINDOW_PAYOUT, WINDOW_SOURCE } from "./window.ts";

export const TOPIC_PAYOUT = keccak256(toHex("Payout(bytes32,address,address,address,uint256,uint8)"));
export const TOPIC_PAYMENT_ENCODED = keccak256(toHex("PaymentEncoded(address,address,address,uint256,uint16,address)"));
export const TOPIC_TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));

/** A log as both viem and the CRE EVM capability can provide it. */
export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface ChainAttestConfig {
  chainId: number;
  payoutRouter: Hex;
  sourceRouter: Hex;
  /** ERC-20s whose transfers to Makers are source payments (USDC) */
  tokens: Hex[];
  makers: Hex[];
}

const topicAddr = (t: Hex | undefined): Hex => `0x${(t ?? "0x").slice(-40)}` as Hex;
const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The log filters a window needs (addresses + topic0 + optional topic filters). */
export function windowLogFilters(cfg: ChainAttestConfig): { address: Hex[]; topics: (Hex[] | null)[] }[] {
  const makerTopics = cfg.makers.map((m) => `0x${m.slice(2).toLowerCase().padStart(64, "0")}` as Hex);
  const filters: { address: Hex[]; topics: (Hex[] | null)[] }[] = [
    { address: [cfg.payoutRouter], topics: [[TOPIC_PAYOUT]] },
    { address: [cfg.sourceRouter], topics: [[TOPIC_PAYMENT_ENCODED]] },
  ];
  if (cfg.tokens.length > 0 && makerTopics.length > 0) {
    filters.push({ address: cfg.tokens, topics: [[TOPIC_TRANSFER], null, makerTopics] });
  }
  return filters;
}

/** Normalize the logs of one block range into source and payout leaves. */
export function leavesFromLogs(
  cfg: ChainAttestConfig,
  logs: RawLog[],
  blockTime: (n: bigint) => bigint,
): { source: Leaf[]; payout: Leaf[] } {
  const source: Leaf[] = [];
  const payout: Leaf[] = [];
  const makers = new Set(cfg.makers.map((m) => m.toLowerCase()));
  for (const l of logs) {
    const t0 = l.topics[0];
    if (t0 === TOPIC_PAYOUT && eqAddr(l.address, cfg.payoutRouter)) {
      const [token, amount, kind] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint8" }], l.data);
      payout.push(
        payoutLeaf({
          chainId: cfg.chainId,
          srcRef: BigInt(l.topics[1]!),
          maker: topicAddr(l.topics[2]),
          recipient: topicAddr(l.topics[3]),
          token,
          amount,
          kind: kind === 3 ? 3 : 2,
          blockNumber: l.blockNumber,
          timestamp: blockTime(l.blockNumber),
        }),
      );
    } else if (t0 === TOPIC_PAYMENT_ENCODED && eqAddr(l.address, cfg.sourceRouter)) {
      const sender = topicAddr(l.topics[1]);
      const maker = topicAddr(l.topics[2]);
      if (!makers.has(maker.toLowerCase())) continue;
      const [token, gross, , recipient] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint16" }, { type: "address" }],
        l.data,
      );
      source.push(
        sourceLeaf({
          chainId: cfg.chainId,
          txHash: l.transactionHash,
          logIndex: l.logIndex,
          sender,
          maker,
          token,
          amount: gross,
          recipient,
          blockNumber: l.blockNumber,
          timestamp: blockTime(l.blockNumber),
        }),
      );
    } else if (t0 === TOPIC_TRANSFER && cfg.tokens.some((t) => eqAddr(t, l.address))) {
      const from = topicAddr(l.topics[1]);
      const to = topicAddr(l.topics[2]);
      // the SourceRouter's forward is already covered by its PaymentEncoded log
      if (eqAddr(from, cfg.sourceRouter)) continue;
      if (!makers.has(to.toLowerCase())) continue;
      // a Maker moving inventory between its own wallets is not a payment
      if (makers.has(from.toLowerCase())) continue;
      const [amount] = decodeAbiParameters([{ type: "uint256" }], l.data);
      source.push(
        sourceLeaf({
          chainId: cfg.chainId,
          txHash: l.transactionHash,
          logIndex: l.logIndex,
          sender: from,
          maker: to,
          token: l.address,
          amount,
          recipient: from,
          blockNumber: l.blockNumber,
          timestamp: blockTime(l.blockNumber),
        }),
      );
    }
  }
  return { source, payout };
}

/** Which block range to attest next: contiguous after `lastTo`, bounded by head and maxBlocks. */
export function nextRange(lastTo: bigint | undefined, startBlock: bigint, safeHead: bigint, maxBlocks: bigint): { from: bigint; to: bigint } | null {
  const from = lastTo === undefined || lastTo === 0n ? startBlock : lastTo + 1n;
  if (safeHead < from) return null;
  const to = safeHead - from + 1n > maxBlocks ? from + maxBlocks - 1n : safeHead;
  return { from, to };
}

/** Build the PAYOUT window (always, for contiguity) and the SOURCE window (only if non-empty). */
export function buildChainWindows(args: {
  cfg: ChainAttestConfig;
  from: bigint;
  to: bigint;
  fromTime: bigint;
  toTime: bigint;
  logs: RawLog[];
  blockTime: (n: bigint) => bigint;
}): { payout: BuiltWindow; source?: BuiltWindow } {
  const { source, payout } = leavesFromLogs(args.cfg, args.logs, args.blockTime);
  const common = { chainId: args.cfg.chainId, fromBlock: args.from, toBlock: args.to, fromTime: args.fromTime, toTime: args.toTime };
  const p = buildWindow({ ...common, kind: WINDOW_PAYOUT, leaves: payout });
  const s = source.length > 0 ? buildWindow({ ...common, kind: WINDOW_SOURCE, leaves: source }) : undefined;
  return { payout: p, source: s };
}

/** A single-transaction SOURCE attestation for a native transfer (kakushi-source-native). */
export function nativeSourceWindow(args: {
  chainId: number;
  txHash: Hex;
  from: Hex;
  to: Hex;
  value: bigint;
  blockNumber: bigint;
  timestamp: bigint;
}): BuiltWindow {
  const leaf = sourceLeaf({
    chainId: args.chainId,
    txHash: args.txHash,
    logIndex: NATIVE_LOG_INDEX,
    sender: args.from,
    maker: args.to,
    token: "0x0000000000000000000000000000000000000000",
    amount: args.value,
    recipient: args.from,
    blockNumber: args.blockNumber,
    timestamp: args.timestamp,
  });
  return buildWindow({
    chainId: args.chainId,
    kind: WINDOW_SOURCE,
    fromBlock: args.blockNumber,
    toBlock: args.blockNumber,
    fromTime: args.timestamp,
    toTime: args.timestamp,
    leaves: [leaf],
  });
}

/** AttestationOracle.onReport body: abi.encode(Window[]). */
export function encodeReport(windows: AttestWindow[]): Hex {
  return encodeAbiParameters([WINDOW_ABI_TYPE], [
    windows.map((w) => ({
      chainId: w.chainId,
      kind: w.kind,
      fromBlock: w.fromBlock,
      toBlock: w.toBlock,
      fromTime: w.fromTime,
      toTime: w.toTime,
      root: w.root,
      leafCount: w.leafCount,
    })),
  ]);
}

export function decodeReport(body: Hex): AttestWindow[] {
  const [ws] = decodeAbiParameters([WINDOW_ABI_TYPE], body);
  return ws.map((w) => ({ ...w, kind: Number(w.kind), leafCount: Number(w.leafCount) }));
}

/** Forwarder raw report = 109-byte header (KeystoneForwarder layout) + body. Local runner only. */
export function rawReport(args: { body: Hex; workflowId: Hex; workflowName: Hex; workflowOwner: Hex; executionId: Hex; timestamp: number }): Hex {
  const h = (x: string, bytes: number) => x.replace(/^0x/, "").padStart(bytes * 2, "0").slice(-bytes * 2);
  const header =
    "01" +
    h(args.executionId, 32) +
    h(args.timestamp.toString(16), 4) +
    h("1", 4) +
    h("1", 4) +
    h(args.workflowId, 32) +
    h(args.workflowName, 10) +
    h(args.workflowOwner, 20) +
    "0001";
  return `0x${header}${args.body.replace(/^0x/, "")}` as Hex;
}

/**
 * CRE allows 15 EVM reads per execution, and every block holding a log needs one header read
 * (for its timestamp). Shrink the window so it holds logs from at most `maxDistinct` blocks:
 * the window then ends right before the first block that would exceed the budget. The next
 * window starts there, so contiguity is preserved.
 */
export function capByDistinctBlocks(logs: RawLog[], from: bigint, to: bigint, maxDistinct: number): { to: bigint; logs: RawLog[]; blocks: bigint[] } {
  const blocks = [...new Set(logs.map((l) => l.blockNumber))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (blocks.length <= maxDistinct) return { to, logs, blocks };
  const cut = blocks[maxDistinct]! - 1n; // last block we can afford
  const newTo = cut < from ? from : cut;
  const kept = logs.filter((l) => l.blockNumber <= newTo);
  return { to: newTo, logs: kept, blocks: blocks.slice(0, maxDistinct).filter((b) => b <= newTo) };
}
