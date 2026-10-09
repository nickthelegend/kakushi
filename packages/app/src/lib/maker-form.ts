import { parseUnits } from "viem";
import { parseBridgeAmount } from "./bridge-state";

export function marginAmount(value: string): bigint {
  const amount = parseBridgeAmount(value, 6);
  if (!amount) throw new Error("Enter a positive USDC amount with at most 6 decimals.");
  return amount;
}

/** Match EBC's uint128 limits, MAX_FEE_BPS and fee/minimum constraints. */
export function routeParameters(form: { withholding: string; bps: string; min: string; max: string }, decimals: number) {
  const minAmount = parseBridgeAmount(form.min, decimals);
  const maxAmount = parseBridgeAmount(form.max, decimals);
  if (!minAmount || !maxAmount || minAmount > maxAmount || maxAmount >= 2n ** 128n) throw new Error("Enter positive route limits within uint128, with maximum at least minimum.");
  if (!/^\d+(?:\.\d*)?$/.test(form.withholding) || (form.withholding.split(".")[1]?.length ?? 0) > decimals) throw new Error("Enter an exact, nonnegative withholding fee.");
  const withholdingFee = parseUnits(form.withholding, decimals);
  if (withholdingFee >= minAmount) throw new Error("Withholding fee must be below the minimum amount.");
  if (!/^\d+$/.test(form.bps) || Number(form.bps) > 1000) throw new Error("Trading fee must be an integer from 0 to 1000 basis points.");
  return { withholdingFee, tradingFeeBps: Number(form.bps), minAmount, maxAmount };
}
