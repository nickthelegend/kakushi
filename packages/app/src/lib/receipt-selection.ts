/** null is invalid; undefined selects the single-payment compatibility view. */
export function receiptLogIndex(value: string | null): number | null | undefined {
  if (value === null || value === "") return undefined;
  if (!/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isInteger(index) && index <= 0xffffffff ? index : null;
}
