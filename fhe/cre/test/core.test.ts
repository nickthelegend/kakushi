import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, type Hex, keccak256, toHex } from "viem";
import { canonical, DECRYPTION_REQUESTED, encodeReport, fromCanonical, isMarker, parseResult, PENDING, requestIdFromTopics, sweepIds } from "../src/core.ts";

const h = (n: number, type = 4) => `0x${n.toString(16).padStart(62, "0")}${type.toString(16).padStart(2, "0")}` as Hex;
const sig = (b: string) => `0x${b.repeat(130)}` as Hex;
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ requestId: "7", handles: [h(1), h(2, 0)], cleartexts: ["1337", "1"], signatures: [sig("A"), sig("b")], decryptedAt: 1, ...over });

test("event topic matches the oracle's DecryptionRequested", () => {
  assert.equal(DECRYPTION_REQUESTED, keccak256(toHex("DecryptionRequested(uint256,address,bytes32[],bytes4)")));
  assert.equal(requestIdFromTopics([DECRYPTION_REQUESTED, `0x${"0".repeat(63)}7`]), 7n);
  assert.throws(() => requestIdFromTopics([keccak256(toHex("Other()")), `0x${"0".repeat(63)}7`]));
});

test("parse -> canonical -> report round-trips and is what onReport decodes", () => {
  const r = parseResult(body(), 7n);
  assert.deepEqual(fromCanonical(canonical(r)), r);
  const [id, clear, sigs] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256[]" }, { type: "bytes[]" }], encodeReport(r));
  assert.equal(id, 7n);
  assert.deepEqual(clear, [1337n, 1n]);
  assert.deepEqual(sigs, [sig("a"), sig("b")]);
});

test("canonical form ignores signature case and extra fields, so honest nodes agree", () => {
  const a = canonical(parseResult(body(), 7n));
  const b = canonical(parseResult(body({ signatures: [sig("a"), sig("B")], decryptedAt: 999 }), 7n));
  assert.equal(a, b);
});

test("malformed or mismatched results are refused", () => {
  assert.throws(() => parseResult(body(), 8n), /not 8/);
  assert.throws(() => parseResult(body({ cleartexts: ["1"] }), 7n));
  assert.throws(() => parseResult(body({ cleartexts: ["-1", "2"] }), 7n));
  assert.throws(() => parseResult(body({ signatures: [] }), 7n));
  assert.throws(() => parseResult(body({ handles: ["0x12", h(2)] }), 7n));
});

test("sweep looks at the newest requests first and stops at id 1", () => {
  assert.deepEqual(sweepIds(5n, 8), [4n, 3n, 2n, 1n]);
  assert.deepEqual(sweepIds(100n, 3), [99n, 98n, 97n]);
  assert.deepEqual(sweepIds(1n, 3), []);
  assert.ok(isMarker(PENDING) && isMarker("ERR:x") && !isMarker("7|"));
});
