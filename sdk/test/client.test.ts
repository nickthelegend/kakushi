import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createWalletClient, http, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FhishClient, FhishType } from "../src/index.ts";
import { seal } from "../../coprocessor/src/seal.ts";

// A stub gateway: verifies the user's EIP-712 authorization like the real one, then seals with the
// real seal(). The FHE engine is out of scope here; the e2e covers it.
const CHAIN = 10143;
const user = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // anvil #1, public
const contract = "0x2de080e97b0cae9825375d31f5d0ed5751fdf16d" as Hex;
const handle = `0x${"ab".repeat(31)}04` as Hex;
const seen: { inputs?: any } = {};

function startGateway(): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/keys/public") return res.end(Buffer.from([1, 2, 3]));
    if (req.url === "/inputs") {
      seen.inputs = b;
      return res.end(JSON.stringify({ handle, proof: "0x1234" }));
    }
    if (req.url === "/decrypt/user") {
      const signer = await recoverTypedDataAddress({
        domain: { name: "Fhish", version: "1", chainId: CHAIN },
        types: { UserDecrypt: [{ name: "handles", type: "bytes32[]" }, { name: "contractAddress", type: "address" }, { name: "publicKey", type: "bytes" }, { name: "expiresAt", type: "uint256" }] },
        primaryType: "UserDecrypt",
        message: { handles: b.handles, contractAddress: b.contract, publicKey: b.publicKey, expiresAt: BigInt(b.expiresAt) },
        signature: b.signature,
      });
      if (signer.toLowerCase() !== b.user.toLowerCase()) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: "bad signature" }));
      }
      return res.end(JSON.stringify({ sealed: b.handles.map((h: string) => ({ handle: h, ...seal(b.publicKey, "1337") })) }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  return new Promise((r) => server.listen(0, () => r({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server })));
}

test("encrypt sends the serialized list, type, user and contract; returns handle + proof", async () => {
  const { url, server } = await startGateway();
  try {
    const encryptor = { encrypt: async (pk: Uint8Array, type: number, v: bigint | boolean) => new Uint8Array([pk.length, type, Number(v)]) };
    const c = new FhishClient({ gatewayUrl: `${url}/`, chainId: CHAIN, encryptor });
    const r = await c.encrypt("euint64", 7, contract, user.address);
    assert.equal(r.handle, handle);
    assert.equal(r.proof, "0x1234");
    assert.deepEqual(Buffer.from(seen.inputs.ciphertext, "base64"), Buffer.from([3, FhishType.euint64, 7]));
    assert.equal(seen.inputs.type, 4);
    assert.equal(seen.inputs.user, user.address);
  } finally {
    server.close();
  }
});

test("userDecrypt signs EIP-712 and opens values sealed to its ephemeral key", async () => {
  const { url, server } = await startGateway();
  try {
    const wallet = createWalletClient({ account: user, transport: http("http://127.0.0.1:1") });
    const c = new FhishClient({ gatewayUrl: url, chainId: CHAIN, encryptor: { encrypt: async () => new Uint8Array() } });
    const out = await c.userDecrypt([handle], contract, wallet);
    assert.equal(out[handle.toLowerCase()], 1337n);
  } finally {
    server.close();
  }
});

test("type codes match the Solidity FhishType library", () => {
  assert.deepEqual(FhishType, { ebool: 0, euint32: 3, euint64: 4 });
});
