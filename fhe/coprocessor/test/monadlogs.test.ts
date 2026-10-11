import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLogs, encodeEventTopics, encodeAbiParameters, type Hex } from "viem";
import { toViemLog } from "../src/monadlogs.ts";
import { executorEvents } from "../src/abi.ts";

test("a monadLogs FheOp (as streamed at Proposed/Voted) decodes into the op the graph needs", () => {
  const result = `0x${"11".repeat(31)}04` as Hex;
  const lhs = `0x${"22".repeat(31)}04` as Hex;
  const rhs = `0x${"33".repeat(31)}04` as Hex;
  const caller = "0x85c5dd61585773423e378146d4bec6f8d149e248" as Hex;
  const topics = encodeEventTopics({ abi: executorEvents, eventName: "FheOp", args: { op: 1, caller } }) as Hex[];
  const data = encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bool" }], [result, lhs, rhs, false]);
  // the exact field set Monad testnet sends (captured from wss://testnet-rpc.monad.xyz)
  const streamed = { blockId: "0xab", commitState: "Voted", address: "0x4488f514D57837771D4b700AB22d4c58Cd66Cd53" as Hex, topics, data, blockHash: `0x${"aa".repeat(32)}` as Hex, blockNumber: "0x424cfad" as Hex, blockTimestamp: "0x0", transactionHash: `0x${"bb".repeat(32)}` as Hex, transactionIndex: "0x2" as Hex, logIndex: "0x5" as Hex, removed: false };
  const l = toViemLog(streamed);
  assert.equal(l.blockNumber, 69521325n);
  assert.equal(l.logIndex, 5);
  assert.equal((l as { commitState?: string }).commitState, "Voted");
  const [ev] = parseEventLogs({ abi: executorEvents, logs: [l] }) as any[];
  assert.equal(ev.eventName, "FheOp");
  assert.equal(ev.args.op, 1);
  assert.equal(ev.args.result, result);
  assert.equal(ev.args.rhs, rhs);
});
