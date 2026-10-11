import { base64 } from "@scure/base";

export type Hex = `0x${string}`;

export function hexToBytes(h: string): Uint8Array {
  const s = h.replace(/^0x/, "");
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error("invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): Hex {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as Hex;
}

export const toB64 = (b: Uint8Array): string => base64.encode(b);
export const fromB64 = (s: string): Uint8Array => base64.decode(s);
