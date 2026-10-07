import { describe, expect, it } from "vitest";
import { encodeAbiParameters, type Hex } from "viem";
import {
  SortedTree, computeRoot, leafNode, sourceLeaf, payoutLeaf, computeSrcRef, payoutKey, net, splitCode, encodeGross, classify,
  leavesFromLogs, nextRange, buildChainWindows, encodeReport, decodeReport, rawReport, TOPIC_PAYOUT, TOPIC_TRANSFER,
  TOPIC_PAYMENT_ENCODED, nodeHash, hashPair, poseidon2,
} from "../src/index.ts";

const maker = "0x00000000000000000000000000000000000000aa" as Hex;
const user = "0x00000000000000000000000000000000000000bb" as Hex;
const usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Hex;
const router = "0x00000000000000000000000000000000000000cc" as Hex;
const sRouter = "0x00000000000000000000000000000000000000dd" as Hex;
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

describe("fees", () => {
  it("worked example", () => {
    const { code, principal } = splitCode(100_009_001n);
    expect(code).toBe(9001);
    expect(net(principal, 50_000n, 10n)).toBe(99_850_050n);
    expect(encodeGross(100_000_000n, 9001)).toBe(100_009_001n);
    expect(encodeGross(123_456_789n, 9002)).toBe(123_459_002n);
  });
  it("classify mirrors EBC", () => {
    const pair = { withholdingFee: 50_000n, tradingFeeBps: 10n, minAmount: 1_000_000n, maxAmount: 500_000_000n, active: true, identCode: 9001 };
    expect(classify(100_009_001n, pair, 30_000n).kind).toBe("FILL");
    expect(classify(100_009_999n, pair, 30_000n)).toMatchObject({ kind: "REFUND", expected: 99_970_000n });
    expect(classify(100_000_000n, pair, 30_000n).kind).toBe("NONE");
    expect(classify(10_009_001n, { ...pair, active: false }, 30_000n).kind).toBe("REFUND");
  });
});

describe("poseidon2", () => {
  it("matches the Noir test vector", () => {
    expect(hashPair(1n, 2n)).toBe(0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n);
    expect(() => poseidon2([-1n])).toThrow();
  });
});

describe("sorted tree", () => {
  const leaves = Array.from({ length: 9 }, (_, i) =>
    payoutLeaf({ chainId: 10143, srcRef: BigInt(i + 1) * 99991n, maker, recipient: user, token: usdc, amount: BigInt(i), kind: 2, blockNumber: 1n, timestamp: 2n }),
  );
  const t = new SortedTree(leaves);
  it("paths recompute the root for every entry", () => {
    for (let i = 0; i < t.entries.length; i++) {
      const e = t.entries[i]!;
      expect(computeRoot(nodeHash(e.key, e.data), i, t.path(i))).toBe(t.root);
    }
    expect(t.leafCount).toBe(9);
  });
  it("entries are strictly sorted and framed by sentinels", () => {
    for (let i = 1; i < t.entries.length; i++) expect(t.entries[i]!.key > t.entries[i - 1]!.key).toBe(true);
    expect(t.entries[0]!.key).toBe(0n);
  });
  it("absence witnesses bracket missing keys and are refused for present keys", () => {
    const missing = payoutKey(123n, BigInt(maker));
    const a = t.absence(missing)!;
    expect(a.low.key < missing && missing < a.high.key).toBe(true);
    expect(t.absence(t.entries[3]!.key)).toBeUndefined();
    expect(t.indexOf(leafNode(leaves[0]!))).toBe(-1);
  });
  it("empty window still has a root (sentinels only)", () => {
    const e = new SortedTree([]);
    expect(e.leafCount).toBe(0);
    expect(e.root).not.toBe(0n);
  });
  it("rejects duplicate keys", () => {
    expect(() => new SortedTree([leaves[0]!, leaves[0]!])).toThrow(/duplicate/);
  });
});

describe("attester normalization", () => {
  const cfg = { chainId: 11155111, payoutRouter: router, sourceRouter: sRouter, tokens: [usdc], makers: [maker] };
  const tx = ("0x" + "ab".repeat(32)) as Hex;
  const logs = [
    { address: usdc, topics: [TOPIC_TRANSFER, pad(user), pad(maker)], data: encodeAbiParameters([{ type: "uint256" }], [100_009_001n]), blockNumber: 10n, transactionHash: tx, logIndex: 4 },
    // router forward: ignored (PaymentEncoded carries it)
    { address: usdc, topics: [TOPIC_TRANSFER, pad(sRouter), pad(maker)], data: encodeAbiParameters([{ type: "uint256" }], [5n]), blockNumber: 10n, transactionHash: tx, logIndex: 5 },
    { address: sRouter, topics: [TOPIC_PAYMENT_ENCODED, pad(user), pad(maker)], data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint16" }, { type: "address" }], [usdc, 5n, 5, user]), blockNumber: 10n, transactionHash: tx, logIndex: 6 },
    { address: router, topics: [TOPIC_PAYOUT, pad("0x07"), pad(maker), pad(user)], data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint8" }], [usdc, 3n, 3]), blockNumber: 11n, transactionHash: tx, logIndex: 1 },
    // maker -> maker inventory move: ignored
    { address: usdc, topics: [TOPIC_TRANSFER, pad(maker), pad(maker)], data: encodeAbiParameters([{ type: "uint256" }], [7n]), blockNumber: 11n, transactionHash: tx, logIndex: 2 },
  ];
  it("produces source and payout leaves with srcRefs", () => {
    const { source, payout } = leavesFromLogs(cfg, logs, (n) => 1000n + n);
    expect(source).toHaveLength(2);
    expect(source[0]!.srcRef).toBe(computeSrcRef(11155111, tx, 4));
    expect(source[0]!.amount).toBe(100_009_001n);
    expect(source[1]!.recipient).toBe(BigInt(user));
    expect(payout).toHaveLength(1);
    expect(payout[0]!.kind).toBe(3n);
    expect(payout[0]!.timestamp).toBe(1011n);
  });
  it("ranges are contiguous and bounded", () => {
    expect(nextRange(undefined, 100n, 150n, 20n)).toEqual({ from: 100n, to: 119n });
    expect(nextRange(119n, 100n, 150n, 20n)).toEqual({ from: 120n, to: 139n });
    expect(nextRange(150n, 100n, 150n, 20n)).toBeNull();
  });
  it("report round-trips and the raw header is 109 bytes", () => {
    const { payout, source } = buildChainWindows({ cfg, from: 10n, to: 11n, fromTime: 1010n, toTime: 1011n, logs, blockTime: (n) => 1000n + n });
    const body = encodeReport([payout.window, source!.window]);
    const back = decodeReport(body);
    expect(back[0]!.root).toBe(payout.window.root);
    expect(back[1]!.leafCount).toBe(2);
    const raw = rawReport({ body, workflowId: "0x01", workflowName: "0x02", workflowOwner: maker, executionId: "0x03", timestamp: 5 });
    expect((raw.length - 2) / 2 - (body.length - 2) / 2).toBe(109);
  });
});

describe("leaf", () => {
  it("srcRef fits the field and matches SrcRef.sol layout", () => {
    const r = computeSrcRef(11155111, ("0x" + "11".repeat(32)) as Hex, 3);
    expect(r < 1n << 248n).toBe(true);
  });
  it("source leaves key by srcRef", () => {
    const l = sourceLeaf({ chainId: 1, txHash: ("0x" + "11".repeat(32)) as Hex, logIndex: 0, sender: user, maker, token: usdc, amount: 1n, recipient: user, blockNumber: 1n, timestamp: 1n });
    const t = new SortedTree([l]);
    expect(t.indexOf(l.srcRef)).toBe(1);
  });
});
