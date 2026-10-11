"use client";
// In-browser encryption with Zama's tfhe 1.8.1 WASM under the Kakushi network public key.
// The value never leaves this tab in plaintext. Threads are used when the page is cross-origin
// isolated (this app sets COOP/COEP).
let mod: Promise<any> | null = null;
let pk: { bytes: Uint8Array; key: any } | null = null;
const LIMIT = BigInt(1) << BigInt(31);

async function tfhe(): Promise<any> {
  mod ??= (async () => {
    const t: any = await import("tfhe");
    await t.default();
    if ((globalThis as any).crossOriginIsolated && typeof t.initThreadPool === "function") {
      await t.initThreadPool(Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1)));
    }
    return t;
  })();
  return mod;
}

export async function networkPublicKey(): Promise<Uint8Array> {
  if (pk) return pk.bytes;
  const r = await fetch("/api/gw/keys/public");
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "network public key unavailable");
  const bytes = new Uint8Array(await r.arrayBuffer());
  pk = { bytes, key: null };
  return bytes;
}

export interface Encrypted {
  bytes: Uint8Array;
  ms: number;
  threads: boolean;
}

export async function encryptInBrowser(type: 0 | 3 | 4, value: bigint | boolean): Promise<Encrypted> {
  const t = await tfhe();
  const pkBytes = await networkPublicKey();
  if (!pk!.key) pk!.key = t.TfheCompactPublicKey.safe_deserialize(pkBytes, LIMIT);
  const t0 = performance.now();
  const b = t.CompactCiphertextList.builder(pk!.key);
  if (type === 0) b.push_boolean(Boolean(value));
  else if (type === 3) b.push_u32(Number(value));
  else b.push_u64(BigInt(value as bigint));
  const bytes: Uint8Array = b.build().safe_serialize(LIMIT);
  return { bytes, ms: Math.round(performance.now() - t0), threads: Boolean((globalThis as any).crossOriginIsolated) };
}

/** An Encryptor for @kakushi/fhe-sdk backed by the same WASM. */
export const browserEncryptor = {
  async encrypt(_publicKey: Uint8Array, type: number, value: bigint | boolean) {
    return (await encryptInBrowser(type as 0 | 3 | 4, value)).bytes;
  },
};
