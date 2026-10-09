import { parseUnits } from "viem";

/** Reject excess precision instead of rounding the user's requested transfer. */
export function parseBridgeAmount(value: string, decimals: number): bigint | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || (value.split(".")[1]?.length ?? 0) > decimals) return null;
  try {
    const amount = parseUnits(value, decimals);
    return amount > 0n && amount < 2n ** 256n ? amount : null;
  } catch { return null; }
}

/** Leave room for both the routing-code dust and the chosen native gas reserve. */
export function maximumPrincipal(balance: bigint, code: number, gasReserve = 0n): bigint {
  const available = balance - gasReserve - BigInt(code);
  return available > 0n ? available - available % 10_000n : 0n;
}

export function requireSuccessfulReceipt<T extends { status: string }>(receipt: T, label: string): T {
  if (receipt.status !== "success") throw new Error(`${label} reverted. Check the transaction and retry.`);
  return receipt;
}
