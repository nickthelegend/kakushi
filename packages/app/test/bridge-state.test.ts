import { describe, expect, it } from "vitest";
import { parseBridgeAmount, maximumPrincipal, requireSuccessfulReceipt } from "../src/lib/bridge-state";

describe("requested payment amounts", () => {
  it("refuses rounding, invalid numbers, zero and uint256 overflow", () => {
    for (const value of ["", "0", "-1", "1.2.3", "1e3", "1.0000009", (2n ** 256n).toString()]) expect(parseBridgeAmount(value, 6)).toBeNull();
    expect(parseBridgeAmount(".5", 6)).toBe(500_000n);
    expect(parseBridgeAmount("5.000001", 6)).toBe(5_000_001n);
  });
  it("max fits the destination code within the actual balance", () => {
    const principal = maximumPrincipal(5_000_000n, 9001);
    expect(principal).toBe(4_990_000n);
    expect(principal + 9001n).toBeLessThanOrEqual(5_000_000n);
    expect(maximumPrincipal(9000n, 9001)).toBe(0n);
  });
  it("native max reserves gas without producing a negative amount", () => {
    expect(maximumPrincipal(5000n, 9003, 10_000n)).toBe(0n);
    expect(maximumPrincipal(100_000n, 9003, 10_000n) + 9003n + 10_000n).toBeLessThanOrEqual(100_000n);
  });
  it("a mined revert cannot authorize the next step or confirmed UI", () => {
    expect(() => requireSuccessfulReceipt({ status: "reverted" }, "Approval")).toThrow("Approval reverted");
    expect(requireSuccessfulReceipt({ status: "success", hash: "0xtx" }, "Payment").hash).toBe("0xtx");
  });
});
