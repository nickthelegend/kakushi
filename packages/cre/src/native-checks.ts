// Pure parts of kakushi-source-native, shared by the workflow, the local runner and tests
// (no @chainlink/cre-sdk import, so Node code can use them).
import type { Hex } from "viem";

export interface NativeRequest {
  chainId: number;
  txHash: Hex;
}

export interface NativeFacts {
  from: Hex;
  to: Hex;
  value: bigint;
  input: Hex;
  status: number;
  blockNumber: bigint;
  timestamp: bigint;
  head: bigint;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : B64[c & 63]!;
  }
  return out;
}

export function parseRequest(raw: Uint8Array | string): NativeRequest {
  const j = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as { chainId?: unknown; txHash?: unknown };
  const chainId = Number(j.chainId);
  const txHash = String(j.txHash ?? "");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("payload.chainId must be a positive integer");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("payload.txHash must be a 32-byte hex hash");
  return { chainId, txHash: txHash as Hex };
}

/** Pack facts deterministically so identical-consensus can compare them. */
export function packFacts(f: NativeFacts): string {
  return [f.from, f.to, f.value, f.input, f.status, f.blockNumber, f.timestamp, f.head].map(String).join("|").toLowerCase();
}

export function unpackFacts(s: string): NativeFacts {
  if (s.startsWith("ERR:")) throw new Error(s.slice(4));
  const [from, to, value, input, status, blockNumber, timestamp, head] = s.split("|");
  return {
    from: from as Hex,
    to: to as Hex,
    value: BigInt(value!),
    input: input as Hex,
    status: Number(status),
    blockNumber: BigInt(blockNumber!),
    timestamp: BigInt(timestamp!),
    head: BigInt(head!),
  };
}

/** The DON-side checks, pure so tests and the local runner share them. */
export function checkNative(f: NativeFacts, makers: Hex[], confirmations: number): string | null {
  if (f.status !== 1) return "transaction reverted";
  if (f.input !== "0x") return "not a plain native transfer (has calldata)";
  if (f.value === 0n) return "zero value";
  if (!makers.some((m) => m.toLowerCase() === f.to.toLowerCase())) return "recipient is not a registered Maker";
  if (f.head - f.blockNumber < BigInt(confirmations)) return "not enough confirmations yet";
  return null;
}

