import { expect, it } from "vitest";
import { receiptLogIndex } from "../src/lib/receipt-selection";
it("selects exact receipt logs without coercing malformed batch identifiers", () => {
  expect(receiptLogIndex(null)).toBeUndefined();
  expect(receiptLogIndex("0")).toBe(0);
  expect(receiptLogIndex("4294967295")).toBe(4294967295);
  for (const value of ["-1", "1.5", "1e2", "4294967296", "not-a-log"]) expect(receiptLogIndex(value)).toBeNull();
});
