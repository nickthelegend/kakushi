// Browser encryptor: Zama's tfhe 1.8.1 WASM (same version as the engine, so lists are compatible).
// Uses multi-threading when the page is cross-origin isolated (COOP/COEP); single-threaded otherwise.
import type { Encryptor } from "./index.ts";

let ready: Promise<any> | null = null;

async function load(): Promise<any> {
  const t: any = await import("tfhe");
  await t.default();
  if ((globalThis as any).crossOriginIsolated && t.initThreadPool) {
    await t.initThreadPool(Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
  }
  return t;
}

export function wasmEncryptor(): Encryptor {
  let pk: any = null;
  let pkFor: Uint8Array | null = null;
  return {
    async encrypt(publicKey, type, value) {
      ready ??= load();
      const t = await ready;
      if (!pk || pkFor !== publicKey) {
        pk = t.TfheCompactPublicKey.safe_deserialize(publicKey, BigInt(1) << BigInt(31));
        pkFor = publicKey;
      }
      const b = t.CompactCiphertextList.builder(pk);
      if (type === 0) b.push_boolean(Boolean(value));
      else if (type === 3) b.push_u32(Number(value));
      else b.push_u64(BigInt(value as bigint));
      return b.build().safe_serialize(BigInt(1) << BigInt(31));
    },
  };
}
