// Gateway HTTP API (public):
//   GET  /health, /metrics
//   GET  /keys/public            the network CompactPublicKey (clients encrypt with it)
//   POST /inputs                 upload a client-encrypted CompactCiphertextList; the engine checks it
//                                is well-formed under the network key; k-of-n input signers attest
//                                (handle, user, contract) -> { handle, proof } for FHE.fromExternal
//   POST /decrypt/user           EIP-712-authorized user decryption, ACL-checked, sealed to the user
//   GET  /decryptions/:id        KMS-signed public decryption result (the Chainlink CRE workflow reads it)
import { createServer } from "node:http";
import { encodePacked, keccak256, toHex, type Hex, type PublicClient, type PrivateKeyAccount, encodeAbiParameters } from "viem";
import { aclAbi } from "./abi.ts";
import type { Engine } from "./engine.ts";
import type { Kms } from "./kms.ts";
import type { Metrics } from "./metrics.ts";
import { seal } from "./seal.ts";

export interface GatewayOpts {
  port: number;
  client: PublicClient;
  chainId: number;
  executor: Hex;
  acl: Hex;
  inputVerifier: Hex;
  inputSigners: PrivateKeyAccount[];
  inputThreshold: number;
  engine: Engine;
  kms: Kms;
  metrics: Metrics;
  log: (m: string) => void;
}

const TYPES = new Set([0, 3, 4]);
const MAX_INPUT = 512 * 1024;

export function inputHandle(listBytes: Uint8Array, type: number, chainId: number, executor: Hex): Hex {
  const h = keccak256(encodePacked(["bytes", "uint8", "uint256", "address"], [toHex(listBytes), type, BigInt(chainId), executor]));
  return `0x${h.slice(2, 64)}${type.toString(16).padStart(2, "0")}` as Hex;
}

export function startGateway(o: GatewayOpts) {
  const json = (res: any, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
    res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  };
  const read = async (req: any): Promise<any> => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_INPUT * 2) throw new Error("payload too large");
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  };
  let pkCache: Uint8Array | null = null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (req.method === "OPTIONS") return json(res, 204, {});
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, chainId: o.chainId, executor: o.executor, engine: await o.engine.health() });
      }
      if (req.method === "GET" && url.pathname === "/metrics") return json(res, 200, o.metrics.snapshot());
      if (req.method === "GET" && url.pathname === "/keys/public") {
        pkCache ??= await o.engine.publicKey();
        res.writeHead(200, { "content-type": "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" });
        return res.end(Buffer.from(pkCache));
      }
      if (req.method === "POST" && url.pathname === "/inputs") {
        const t0 = Date.now();
        const b = await read(req);
        const type = Number(b.type);
        if (!TYPES.has(type)) return json(res, 400, { error: "type must be 0 (ebool), 3 (euint32) or 4 (euint64)" });
        if (!/^0x[0-9a-fA-F]{40}$/.test(b.user ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(b.contract ?? "")) return json(res, 400, { error: "user and contract addresses are required" });
        const list = Buffer.from(String(b.ciphertext ?? ""), "base64");
        if (list.length === 0 || list.length > MAX_INPUT) return json(res, 400, { error: "ciphertext missing or too large" });
        const handle = inputHandle(list, type, o.chainId, o.executor);
        // the engine refuses anything that is not a well-formed list under the network key
        await o.engine.input(handle, type, list.toString("base64"));
        const domain = { name: "KakushiInputVerifier", version: "1", chainId: o.chainId, verifyingContract: o.inputVerifier } as const;
        const types = { InputAttestation: [{ name: "handle", type: "bytes32" }, { name: "user", type: "address" }, { name: "contractAddress", type: "address" }] } as const;
        const sigs = await Promise.all(
          o.inputSigners.slice(0, o.inputThreshold).map((s) => s.signTypedData({ domain, types, primaryType: "InputAttestation", message: { handle, user: b.user, contractAddress: b.contract } })),
        );
        const proof = encodeAbiParameters([{ type: "bytes[]" }], [sigs]);
        o.metrics.add("input", Date.now() - t0);
        o.metrics.inc("inputs");
        return json(res, 200, { handle, proof });
      }
      if (req.method === "POST" && url.pathname === "/decrypt/user") {
        const t0 = Date.now();
        const b = await read(req);
        const handles = (b.handles ?? []) as Hex[];
        if (!Array.isArray(handles) || handles.length === 0 || handles.length > 16) return json(res, 400, { error: "1..16 handles" });
        const expiresAt = BigInt(b.expiresAt ?? 0);
        if (expiresAt < BigInt(Math.floor(Date.now() / 1000))) return json(res, 401, { error: "authorization expired" });
        const ok = await o.client.verifyTypedData({
          address: b.user,
          domain: { name: "Kakushi FHE", version: "1", chainId: o.chainId },
          types: { UserDecrypt: [{ name: "handles", type: "bytes32[]" }, { name: "contractAddress", type: "address" }, { name: "publicKey", type: "bytes" }, { name: "expiresAt", type: "uint256" }] },
          primaryType: "UserDecrypt",
          message: { handles, contractAddress: b.contract, publicKey: b.publicKey, expiresAt },
          signature: b.signature,
        });
        if (!ok) return json(res, 401, { error: "bad signature" });
        const sealed = [];
        for (const h of handles) {
          const [u, c] = await Promise.all([
            o.client.readContract({ address: o.acl, abi: aclAbi, functionName: "isAllowed", args: [h, b.user] }),
            o.client.readContract({ address: o.acl, abi: aclAbi, functionName: "isAllowed", args: [h, b.contract] }),
          ]);
          if (!u || !c) return json(res, 403, { error: `not allowed to decrypt ${h}` });
          await o.kms.opts.graph.waitFor(h, 60_000);
          sealed.push({ handle: h, ...seal(b.publicKey, (await o.engine.decrypt(h)).toString()) });
        }
        o.metrics.add("user_decrypt", Date.now() - t0);
        return json(res, 200, { sealed });
      }
      const m = url.pathname.match(/^\/decryptions\/(\d+)$/);
      if (req.method === "GET" && m) {
        const r = o.kms.results.get(m[1]!);
        return r ? json(res, 200, r) : json(res, 404, { error: "not decrypted yet" });
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      o.metrics.inc("gateway.errors");
      json(res, 400, { error: (e as Error).message.split("\n")[0] });
    }
  });
  server.listen(o.port, () => o.log(`gateway on :${o.port}`));
  return server;
}
