// Normative fee math (PLAN.md §7.3). Mirrors FeeMath.sol and kakushi_lib (Noir).
export const CODE_MOD = 10_000n;
export const BPS = 10_000n;

export function splitCode(gross: bigint): { code: number; principal: bigint } {
  const code = gross % CODE_MOD;
  return { code: Number(code), principal: gross - code };
}

/** net = (principal - withholding) - floor((principal - withholding) * bps / 10_000); 0 if principal <= withholding */
export function net(principal: bigint, withholding: bigint, bps: bigint): bigint {
  if (principal <= withholding) return 0n;
  const base = principal - withholding;
  return base - (base * bps) / BPS;
}

/** Build the exact gross a sender must transfer: principal rounded down to 10^4 base units + code. */
export function encodeGross(desired: bigint, code: number): bigint {
  if (code <= 0 || code >= 10_000) throw new Error(`invalid ident code ${code}`);
  return desired - (desired % CODE_MOD) + BigInt(code);
}

export interface PairParams {
  withholdingFee: bigint;
  tradingFeeBps: bigint;
  minAmount: bigint;
  maxAmount: bigint;
}

export type ObligationKind = "NONE" | "FILL" | "REFUND";

/** Off-chain mirror of EBC.classify for one known pair (or none) and a refund fee. */
export function classify(
  gross: bigint,
  pair: (PairParams & { active: boolean; identCode: number }) | undefined,
  refundFee: bigint,
): { kind: ObligationKind; expected: bigint; code: number; principal: bigint; withholding: bigint; bps: bigint } {
  const { code, principal } = splitCode(gross);
  if (code === 0) return { kind: "NONE", expected: 0n, code, principal, withholding: 0n, bps: 0n };
  if (
    pair &&
    pair.active &&
    pair.identCode === code &&
    principal >= pair.minAmount &&
    principal <= pair.maxAmount &&
    principal > pair.withholdingFee
  ) {
    return {
      kind: "FILL",
      expected: net(principal, pair.withholdingFee, pair.tradingFeeBps),
      code,
      principal,
      withholding: pair.withholdingFee,
      bps: pair.tradingFeeBps,
    };
  }
  if (principal > refundFee) {
    return { kind: "REFUND", expected: principal - refundFee, code, principal, withholding: refundFee, bps: 0n };
  }
  return { kind: "NONE", expected: 0n, code, principal, withholding: 0n, bps: 0n };
}
