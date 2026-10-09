// Static validation of a POST /relay body. Everything here is checked before any RPC call;
// the on-chain rules (proof, known root, unspent nullifier) are then checked by eth_call.
import { type Hex, getAddress, isAddress, zeroAddress } from "viem";
import { FIELD_MODULUS } from "@kakushi/sdk";
import type { PoolConfig } from "./config.ts";

export class RelayError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface WithdrawArgs {
  root: Hex;
  nullifierHash: Hex;
  recipient: Hex;
  relayer: Hex;
  fee: bigint;
  refund: bigint;
}

export interface RelayRequest {
  chainId: number;
  pool: PoolConfig;
  proof: Hex;
  args: WithdrawArgs;
}

/** UltraHonk proofs are ~14-16 KB; anything far larger is not a withdraw proof. */
export const MAX_PROOF_BYTES = 48 * 1024;
const MAX_UINT256 = 2n ** 256n - 1n;

const bad = (msg: string): never => {
  throw new RelayError(400, msg);
};

function field32(v: unknown, name: string): Hex {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) return bad(`${name} must be a 0x-prefixed bytes32`);
  if (BigInt(v) >= FIELD_MODULUS) return bad(`${name} is not a BN254 field element`);
  return v.toLowerCase() as Hex;
}

function uint(v: unknown, name: string): bigint {
  let x: bigint;
  if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) x = BigInt(v);
  else if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) x = BigInt(v);
  else return bad(`${name} must be a non-negative integer (decimal or 0x string)`);
  if (x > MAX_UINT256) return bad(`${name} exceeds uint256`);
  return x;
}

function address(v: unknown, name: string): Hex {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) return bad(`${name} must be an address`);
  return getAddress(v);
}

/**
 * Validate a relay request against this relayer's pools and address.
 * Body: { chainId, pool, proof, args | publicInputs: { root, nullifierHash, recipient, relayer, fee, refund } }
 */
export function validateRelayRequest(body: unknown, ctx: { relayer: Hex; pools: readonly PoolConfig[] }): RelayRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("body must be a JSON object");
  const b = body as Record<string, unknown>;

  const chainId = typeof b.chainId === "string" && /^\d+$/.test(b.chainId) ? Number(b.chainId) : b.chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) return bad("chainId must be a positive integer");
  const poolAddr = address(b.pool, "pool");
  const pool = ctx.pools.find((p) => p.chainId === chainId && p.pool.toLowerCase() === poolAddr.toLowerCase());
  if (!pool) {
    return ctx.pools.some((p) => p.chainId === chainId)
      ? bad(`pool ${poolAddr} is not a Kakushi pool this relayer serves on chain ${chainId}`)
      : bad(`this relayer does not serve chain ${chainId}`);
  }

  if (typeof b.proof !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(b.proof)) return bad("proof must be non-empty 0x-prefixed bytes");
  if ((b.proof.length - 2) / 2 > MAX_PROOF_BYTES) return bad(`proof is larger than ${MAX_PROOF_BYTES} bytes`);

  const a = (b.args ?? b.publicInputs) as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || Array.isArray(a)) return bad("args (or publicInputs) must be an object {root, nullifierHash, recipient, relayer, fee, refund}");

  const args: WithdrawArgs = {
    root: field32(a.root, "root"),
    nullifierHash: field32(a.nullifierHash, "nullifierHash"),
    recipient: address(a.recipient, "recipient"),
    relayer: address(a.relayer, "relayer"),
    fee: uint(a.fee, "fee"),
    refund: uint(a.refund ?? 0, "refund"),
  };

  if (args.recipient === zeroAddress) return bad("recipient must not be the zero address");
  if (args.recipient.toLowerCase() === pool.pool.toLowerCase()) return bad("recipient must not be the pool");
  if (args.relayer.toLowerCase() !== ctx.relayer.toLowerCase()) {
    return bad(`relayer must be this relayer's address ${getAddress(ctx.relayer)} (the fee is paid to the address bound in the proof)`);
  }
  if (args.fee < pool.minFee) return bad(`fee ${args.fee} is below this pool's minimum ${pool.minFee}`);
  if (args.refund !== 0n) return bad("refund must be 0: this relayer does not front gas refunds");

  return { chainId, pool, proof: b.proof.toLowerCase() as Hex, args };
}
