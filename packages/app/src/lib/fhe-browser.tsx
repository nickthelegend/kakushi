"use client";

// Kakushi Confidential in the browser: encrypt with Zama's tfhe 1.8.1 WASM (the engine's version, so
// ciphertext lists are compatible) under the network public key. The value never leaves this tab in
// plaintext. A thread pool is used when the page is cross-origin isolated (COOP/COEP, set only on
// /confidential by next.config.ts); otherwise the same WASM runs single-threaded, which is slower
// but works everywhere (Safari has no COEP credentialless; Privy's iframe needs isolation off).
import { useMemo } from "react";
import { KakushiFheClient, type Encryptor } from "@kakushi/fhe-sdk";
import { useRuntime } from "./runtime";
import { useWallet } from "./wallet";
import { walletSigner, type ConfidentialEnv, type ConfidentialSigner } from "./confidential";

const LIMIT = BigInt(1) << BigInt(31);
/** tfhe's browser build, served as static ES modules (scripts/vendor-tfhe.mjs; not bundled). */
export const TFHE_URL = "/vendor/tfhe-1.8.1/tfhe.js";
// a runtime import the bundler cannot see: the module, its WASM and its worker helper load as-is
const importStatic = new Function("u", "return import(u)") as (u: string) => Promise<any>;
let mod: Promise<any> | null = null;
let key: { bytes: Uint8Array; pk: any } | null = null;

export const isolated = () => typeof window !== "undefined" && Boolean((window as { crossOriginIsolated?: boolean }).crossOriginIsolated);

async function tfhe(): Promise<any> {
  mod ??= (async () => {
    const t: any = await importStatic(TFHE_URL);
    await t.default();
    if (isolated() && typeof t.initThreadPool === "function") {
      await t.initThreadPool(Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1)));
    }
    return t;
  })().catch((e) => {
    mod = null;
    throw e;
  });
  return mod;
}

/** Last encryption's timing, for the collapsed details of a result. */
export const lastEncryption = { ms: 0, threads: false };

export const browserEncryptor: Encryptor = {
  async encrypt(publicKey, type, value) {
    const t = await tfhe();
    if (!key || key.bytes !== publicKey) key = { bytes: publicKey, pk: t.TfheCompactPublicKey.safe_deserialize(publicKey, LIMIT) };
    const t0 = performance.now();
    const b = t.CompactCiphertextList.builder(key.pk);
    if (type === 0) b.push_boolean(Boolean(value));
    else if (type === 3) b.push_u32(Number(value));
    else b.push_u64(BigInt(value as bigint));
    const out: Uint8Array = b.build().safe_serialize(LIMIT);
    lastEncryption.ms = Math.round(performance.now() - t0);
    lastEncryption.threads = isolated();
    return out;
  },
};

/** The FHE environment for this network, or null when Kakushi Confidential is not live here. */
export function useConfidential(): { env: ConfidentialEnv | null; ready: boolean; signer: () => Promise<ConfidentialSigner> } {
  const { cfg, k } = useRuntime();
  const w = useWallet();
  const fhe = cfg?.fhe ?? null;
  const env = useMemo<ConfidentialEnv | null>(() => {
    if (!fhe || !k) return null;
    return { client: k.client("monadTestnet") as ConfidentialEnv["client"], fhe: new KakushiFheClient({ gatewayUrl: fhe.gateway, chainId: fhe.chainId, encryptor: browserEncryptor }), cfg: fhe };
  }, [fhe, k]);
  return { env, ready: Boolean(cfg), signer: async () => walletSigner(await w.walletClient("monadTestnet")) };
}
