import { describe, expect, it } from "vitest";
import { marginAmount, routeParameters } from "../src/lib/maker-form";
const form = { withholding: "0.05", bps: "10", min: "1", max: "500" };
describe("Maker's actual contract limits", () => {
  it("refuses silent margin rounding or zero-value approvals", () => {
    for (const value of ["0", "", "1.0000001", "1e2"]) expect(() => marginAmount(value)).toThrow();
    expect(marginAmount("1.000001")).toBe(1_000_001n);
  });
  it("preserves legal amounts and the exact 10 percent boundary", () => {
    expect(routeParameters({ ...form, bps: "1000" }, 6)).toEqual({ withholdingFee: 50_000n, tradingFeeBps: 1000, minAmount: 1_000_000n, maxAmount: 500_000_000n });
    expect(routeParameters({ ...form, withholding: "0" }, 6).withholdingFee).toBe(0n);
  });
  it("rejects routes which the EBC cannot register", () => {
    for (const patch of [{ bps: "1001" }, { bps: "0.5" }, { bps: "" }, { min: "0" }, { min: "501" }, { withholding: "1" }, { withholding: "0.0000001" }, { max: (2n ** 128n).toString() }]) expect(() => routeParameters({ ...form, ...patch }, 6)).toThrow();
  });
});
