import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { MakerDb } from "../src/db.ts";
import { authorizationSignature, canonicalize, makerSigner, privyConfigFromEnv } from "../src/signer.ts";

const row = (srcRef: string) => ({
  srcRef, srcChainId: 11155111, txHash: "0xab", logIndex: 1, sender: "0x1", token: "0x2", gross: "5009001", recipient: "0x1",
  blockNumber: "10", timestamp: 1_800_000_000, via: "raw-erc20", kind: "FILL", expected: "4962545", obligationChainId: 10143, seenAt: Date.now(),
});

describe("maker db", () => {
  it("one srcRef is recorded once (idempotency across restarts)", () => {
    const db = new MakerDb(":memory:");
    expect(db.insert(row("0x01"))).toBe(true);
    expect(db.insert(row("0x01"))).toBe(false);
    expect(db.pending()).toHaveLength(1);
  });
  it("a payment can be claimed for payout only once", () => {
    const db = new MakerDb(":memory:");
    db.insert(row("0x02"));
    expect(db.claim("0x02")).toBe(true);
    expect(db.claim("0x02")).toBe(false);
    expect(db.inFlight()).toHaveLength(1);
    db.setStatus("0x02", "filled", { payoutTx: "0xff", executedMs: 300 });
    expect(db.get("0x02")?.status).toBe("filled");
    expect(db.inFlight()).toHaveLength(0);
    expect(db.stats()).toEqual({ filled: 1 });
  });
  it("cursors persist", () => {
    const db = new MakerDb(":memory:");
    expect(db.cursor(1)).toBeUndefined();
    db.setCursor(1, 42n);
    db.setCursor(1, 43n);
    expect(db.cursor(1)).toBe(43n);
  });
});

describe("privy signer", () => {
  it("canonicalizes JSON with sorted keys", () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it("authorization signature verifies against the P-256 public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const key = `wallet-auth:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`;
    const payload = { url: "https://api.privy.io/v1/wallets/w1/rpc", body: { method: "eth_signTransaction", params: { transaction: { to: "0x1" } } }, appId: "app" };
    const sig = authorizationSignature(key, payload);
    const v = createVerify("sha256");
    v.update(canonicalize({ version: 1, method: "POST", url: payload.url, body: payload.body, headers: { "privy-app-id": "app" } }));
    expect(v.verify(publicKey, Buffer.from(sig, "base64"))).toBe(true);
  });
  it("is not configured without all Privy variables; falls back to a local key", () => {
    expect(privyConfigFromEnv({ PRIVY_APP_ID: "x" })).toBeNull();
    const s = makerSigner({ MAKER_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
    expect(s.kind).toBe("local");
    expect(s.account.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(() => makerSigner({})).toThrow(/MAKER_KEY/);
  });
});
