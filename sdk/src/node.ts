// Node encryptor: the native fhish-engine CLI encrypts locally (the value never leaves this machine).
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Encryptor } from "./index.ts";

const run = promisify(execFile);

export function nativeEncryptor(engineBin = process.env.FHISH_ENGINE_BIN ?? "fhish-engine"): Encryptor {
  let pkPath: string | null = null;
  let pkFor: Uint8Array | null = null;
  return {
    async encrypt(publicKey, type, value) {
      if (!pkPath || pkFor !== publicKey) {
        pkPath = join(await mkdtemp(join(tmpdir(), "fhish-")), "public_key.bin");
        await writeFile(pkPath, publicKey);
        pkFor = publicKey;
      }
      const v = typeof value === "boolean" ? (value ? "1" : "0") : value.toString();
      const { stdout } = await run(engineBin, ["encrypt", "--pk", pkPath, "--type", String(type), "--value", v]);
      return Uint8Array.from(Buffer.from(stdout.trim(), "base64"));
    },
  };
}
