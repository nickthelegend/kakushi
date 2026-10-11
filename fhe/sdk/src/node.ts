// Node encryptor: the native kakushi-fhe-engine CLI encrypts locally (the value never leaves this machine).
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Encryptor } from "./index.ts";

const run = promisify(execFile);

export function nativeEncryptor(engineBin = process.env.KAKUSHI_FHE_ENGINE_BIN ?? "kakushi-fhe-engine"): Encryptor {
  let pkPath: string | null = null;
  let pkFor: Uint8Array | null = null;
  return {
    async encrypt(publicKey, type, value) {
      if (!pkPath || pkFor !== publicKey) {
        pkPath = join(await mkdtemp(join(tmpdir(), "fhe-")), "public_key.bin");
        await writeFile(pkPath, publicKey);
        pkFor = publicKey;
      }
      const v = typeof value === "boolean" ? (value ? "1" : "0") : value.toString();
      const { stdout } = await run(engineBin, ["encrypt", "--pk", pkPath, "--type", String(type), "--value", v]);
      return Uint8Array.from(Buffer.from(stdout.trim(), "base64"));
    },
  };
}

/**
 * Pure-JS Node encryptor: Zama's node-tfhe 1.8.1 (the same tfhe-rs version as the engine, so the
 * lists are compatible). No binary needed; single-threaded, which is fine for one input at a time.
 */
export function nodeTfheEncryptor(): Encryptor {
  let t: any = null;
  let pk: any = null;
  let pkFor: Uint8Array | null = null;
  const LIMIT = BigInt(1) << BigInt(31);
  return {
    async encrypt(publicKey, type, value) {
      t ??= await import("node-tfhe" as string);
      if (!pk || pkFor !== publicKey) {
        pk = t.TfheCompactPublicKey.safe_deserialize(publicKey, LIMIT);
        pkFor = publicKey;
      }
      const b = t.CompactCiphertextList.builder(pk);
      if (type === 0) b.push_boolean(Boolean(value));
      else if (type === 3) b.push_u32(Number(value));
      else b.push_u64(BigInt(value as bigint));
      return b.build().safe_serialize(LIMIT) as Uint8Array;
    },
  };
}
