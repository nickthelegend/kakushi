// Sealed output: a user-decrypted value is encrypted to the user's ephemeral P-256 key
// (ECDH -> HKDF-SHA256 -> AES-256-GCM), so it never travels or sits anywhere in plaintext.
// The SDK unseals with WebCrypto (browser) or node:crypto.
import { createECDH, createCipheriv, hkdfSync, randomBytes } from "node:crypto";

export interface Sealed {
  epk: string; // server ephemeral public key, uncompressed hex
  iv: string;
  ct: string; // ciphertext || 16-byte tag, hex
}

export function seal(clientPublicKeyHex: string, plaintext: string): Sealed {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const shared = ecdh.computeSecret(Buffer.from(clientPublicKeyHex.replace(/^0x/, ""), "hex"));
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("fhish-seal-v1"), 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final(), c.getAuthTag()]);
  return { epk: ecdh.getPublicKey("hex"), iv: iv.toString("hex"), ct: ct.toString("hex") };
}
