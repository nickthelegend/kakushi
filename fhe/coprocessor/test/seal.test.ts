import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { seal } from "../src/seal.ts";
import { inputHandle } from "../src/gateway.ts";

const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("hex");

test("sealed output opens only with the client's ephemeral key (same steps as the SDK)", async () => {
  const subtle = webcrypto.subtle;
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = hex(await subtle.exportKey("raw", kp.publicKey));
  const s = seal(pub, "1337");
  const epk = await subtle.importKey("raw", Buffer.from(s.epk, "hex"), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, kp.privateKey, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("kakushi-fhe-seal-v1") },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(s.iv, "hex") }, key, Buffer.from(s.ct, "hex"));
  assert.equal(new TextDecoder().decode(pt), "1337");

  // another key cannot open it
  const other = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const bad = await subtle.deriveBits({ name: "ECDH", public: epk }, other.privateKey, 256);
  const hk2 = await subtle.importKey("raw", bad, "HKDF", false, ["deriveKey"]);
  const key2 = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("kakushi-fhe-seal-v1") }, hk2, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  await assert.rejects(subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(s.iv, "hex") }, key2, Buffer.from(s.ct, "hex")));
});

test("input handles carry the type byte and bind chain + executor", () => {
  const list = new Uint8Array([1, 2, 3]);
  const ex = "0x4488f514D57837771D4b700AB22d4c58Cd66Cd53" as const;
  const h = inputHandle(list, 4, 10143, ex);
  assert.equal(h.length, 66);
  assert.ok(h.endsWith("04"));
  assert.equal(inputHandle(list, 4, 10143, ex), h, "deterministic");
  assert.notEqual(inputHandle(list, 4, 143, ex), h, "different chain, different handle");
  assert.notEqual(inputHandle(list, 3, 10143, ex), h.slice(0, -2) + "03", "type is hashed, not only appended");
});
