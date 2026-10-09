// Opens values the Fhish gateway sealed to this device (coprocessor/src/seal.ts), without WebCrypto
// (React Native has no crypto.subtle). Same scheme, byte for byte:
//   ECDH P-256 (shared secret = x coordinate) -> HKDF-SHA256(salt = empty, info = "fhish-seal-v1", 32 B)
//   -> AES-256-GCM (12-byte iv, ciphertext || 16-byte tag) -> decimal string.
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "./bytes.ts";

export interface SealedValue {
  handle: string;
  epk: string;
  iv: string;
  ct: string;
}

const INFO = new TextEncoder().encode("fhish-seal-v1");

/** A one-shot P-256 key pair for one reveal. The secret never leaves this function's caller. */
export function ephemeralKey(): { secret: Uint8Array; publicKeyHex: `0x${string}` } {
  const secret = p256.utils.randomSecretKey();
  return { secret, publicKeyHex: bytesToHex(p256.getPublicKey(secret, false)) };
}

export function unseal(secret: Uint8Array, s: Pick<SealedValue, "epk" | "iv" | "ct">): bigint {
  const shared = p256.getSharedSecret(secret, hexToBytes(s.epk), true).slice(1); // x coordinate
  const key = hkdf(sha256, shared, new Uint8Array(0), INFO, 32);
  const pt = gcm(key, hexToBytes(s.iv)).decrypt(hexToBytes(s.ct));
  let str = "";
  for (const b of pt) {
    if (b < 48 || b > 57) throw new Error("sealed value is not a decimal");
    str += String.fromCharCode(b);
  }
  shared.fill(0);
  key.fill(0);
  return BigInt(str);
}
