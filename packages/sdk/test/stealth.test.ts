import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  type Hex,
  bytesToHex,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  numberToHex,
  pad,
} from "viem";
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts";
import {
  NATIVE_TOKEN,
  STEALTH_KEYS_MESSAGE,
  buildRegisterKeysCalldata,
  checkStealthAddress,
  computeStealthPrivateKey,
  decodeStealthMetadata,
  deriveStealthKeys,
  encodeStealthMetadata,
  erc5564AnnouncerAbi,
  erc6538RegistryAbi,
  generateStealthAddress,
  generateStealthKeys,
  parseMetaAddress,
  readStealthMetaAddress,
  scanAnnouncements,
  stealthBalance,
  stealthKeysFromPrivateKeys,
} from "../src/index.ts";

// ScopeLift/stealth-address-sdk test fixtures (src/utils/crypto/test/computeStealthKey.test.ts):
// these private keys produce exactly this meta-address.
const SL_META =
  "st:eth:0x033404e82cd2a92321d51e13064ec13a0fb0192a9fdaaca1cfb47b37bd27ec13970390ad5eca026c05ab5cf4d620a2ac65241b11df004ddca360e954db1b26e3846e";
const SL_SPEND = "0x363721eb9e981558c748b824cb32a840da2b3e8957c2fc3bcb8d9c86cb87456" as Hex;
const SL_VIEW = "0xb52a0555f6a8663d89f00365893b1ef9e38eaf2e8bc48a63319c9ea5cb4a27c5" as Hex;

// Known-answer vector for a fixed ephemeral key, computed independently of this code (pure-Python
// secp256k1 point arithmetic + Foundry `cast keccak` / `cast wallet address`) following the
// reference SDK: s_h = keccak256(compressed(p_e * P_view)).
const KAT = {
  ephemeralPrivateKey: "0x0f6ad1b1c2e0c5a45f1d3b9c1e0a4e1d7c9b8a7f6e5d4c3b2a1908f7e6d5c4b3" as Hex,
  ephemeralPublicKey: "0x02575cd0f370009937f2be0fd28331d69b1e55073b3b96350b923953160d62e76a",
  viewTag: 0x06,
  stealthPrivateKey: "0x0a43597aa92e22f40aea2818a0985c2d1a5d450f7437c6a2d9f723be5582df5d",
  stealthAddress: "0x4968c8CFF00e874D425Ffb183E607126295Daa0A",
};

const randKey = (): Hex => bytesToHex(secp256k1.utils.randomPrivateKey());
const addrOfKey = (k: Hex) => publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(k.slice(2), false)));

describe("ERC-5564 scheme 1 reference vectors", () => {
  it("reference SDK private keys give the reference meta-address", () => {
    expect(stealthKeysFromPrivateKeys(SL_SPEND, SL_VIEW).metaAddress).toBe(SL_META);
  });
  it("parses the reference meta-address into its two compressed keys", () => {
    const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(SL_META);
    expect(spendingPublicKey).toBe("0x033404e82cd2a92321d51e13064ec13a0fb0192a9fdaaca1cfb47b37bd27ec1397");
    expect(viewingPublicKey).toBe("0x0390ad5eca026c05ab5cf4d620a2ac65241b11df004ddca360e954db1b26e3846e");
  });
  it("reference checkStealthAddress fixture: viewing key matches its meta-address", () => {
    const meta = "st:eth:0x02f1f006a160b934c1d71479ce7d57f1c4ec10018230e35ca10ab65db68e8f037b0305d4725c7784262a38af11a9aef490b1307b82b17866f08d66c38db04c946ab1";
    const view = "0x2f8fcb2d1e06f52695e06a792b6d59c80a81ad70fc11b03b5236eed5cff09670" as Hex;
    expect(parseMetaAddress(meta).viewingPublicKey).toBe(bytesToHex(secp256k1.getPublicKey(view.slice(2), true)));
    const g = generateStealthAddress(meta);
    expect(checkStealthAddress({ stealthAddress: g.stealthAddress, ephemeralPubKey: g.ephemeralPublicKey, metadata: encodeStealthMetadata({ viewTag: g.viewTag }) }, view, parseMetaAddress(meta).spendingPublicKey)).toBe(true);
  });
  it("matches the independently computed known-answer vector", () => {
    const g = generateStealthAddress(SL_META, { ephemeralPrivateKey: KAT.ephemeralPrivateKey });
    expect(g).toEqual({ stealthAddress: KAT.stealthAddress, ephemeralPublicKey: KAT.ephemeralPublicKey, viewTag: KAT.viewTag });
    const priv = computeStealthPrivateKey(SL_SPEND, SL_VIEW, g.ephemeralPublicKey);
    expect(priv).toBe(KAT.stealthPrivateKey);
    expect(privateKeyToAccount(priv).address).toBe(KAT.stealthAddress);
  });
});

describe("stealth keys", () => {
  const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  it("are deterministic from the wallet signature and well formed", async () => {
    const a = await deriveStealthKeys(signer);
    const b = generateStealthKeys(await signer.signMessage({ message: STEALTH_KEYS_MESSAGE }));
    expect(a).toEqual(b);
    expect(a.metaAddress).toMatch(/^st:eth:0x0[23][0-9a-f]{64}0[23][0-9a-f]{64}$/);
    expect(a.spendingKey).not.toBe(a.viewingKey);
    expect(stealthKeysFromPrivateKeys(a.spendingKey, a.viewingKey)).toEqual(a);
  });
  it("differ per signer and reject short seeds", async () => {
    const other = privateKeyToAccount(randKey());
    expect((await deriveStealthKeys(other)).metaAddress).not.toBe((await deriveStealthKeys(signer)).metaAddress);
    expect(() => generateStealthKeys("0x1234")).toThrow(/at least 32 bytes/);
  });
  it("meta-address parsing rejects malformed input", () => {
    expect(() => parseMetaAddress("st:eth:0x1234")).toThrow(/33 or 66/);
    expect(() => parseMetaAddress("eth:0x00")).toThrow();
    expect(() => parseMetaAddress(SL_META.replace("0x03", "0x04"))).toThrow(/compressed/);
    const single = parseMetaAddress(SL_META.slice(0, 7 + 2 + 66));
    expect(single.viewingPublicKey).toBe(single.spendingPublicKey);
  });
});

describe("generate / check / spend (property test over random keys)", () => {
  it("the derived private key controls the stealth address; others do not match", () => {
    for (let i = 0; i < 48; i++) {
      const keys = stealthKeysFromPrivateKeys(randKey(), randKey());
      const g = generateStealthAddress(keys.metaAddress);
      const ann = { stealthAddress: g.stealthAddress, ephemeralPubKey: g.ephemeralPublicKey, metadata: encodeStealthMetadata({ viewTag: g.viewTag, token: "native", amount: BigInt(i) }) };
      expect(checkStealthAddress(ann, keys.viewingKey, keys.spendingPublicKey)).toBe(true);
      const priv = computeStealthPrivateKey(keys.spendingKey, keys.viewingKey, g.ephemeralPublicKey);
      expect(addrOfKey(priv)).toBe(g.stealthAddress);
      // someone else's keys
      const stranger = stealthKeysFromPrivateKeys(randKey(), randKey());
      expect(checkStealthAddress(ann, stranger.viewingKey, stranger.spendingPublicKey)).toBe(false);
      // right viewing key, wrong spending key: tag passes, address fails
      expect(checkStealthAddress(ann, keys.viewingKey, stranger.spendingPublicKey)).toBe(false);
    }
  });
  it("view-tag fast path rejects a wrong tag even for the right keys", () => {
    const keys = stealthKeysFromPrivateKeys(SL_SPEND, SL_VIEW);
    const g = generateStealthAddress(keys.metaAddress, { ephemeralPrivateKey: KAT.ephemeralPrivateKey });
    const wrong = encodeStealthMetadata({ viewTag: (g.viewTag + 1) % 256 });
    expect(checkStealthAddress({ stealthAddress: g.stealthAddress, ephemeralPubKey: g.ephemeralPublicKey, metadata: wrong }, keys.viewingKey, keys.spendingPublicKey)).toBe(false);
    // without metadata the full check still finds it
    expect(checkStealthAddress({ stealthAddress: g.stealthAddress, ephemeralPubKey: g.ephemeralPublicKey }, keys.viewingKey, keys.spendingPublicKey)).toBe(true);
    // garbage ephemeral key never throws
    expect(checkStealthAddress({ stealthAddress: g.stealthAddress, ephemeralPubKey: "0x0200" }, keys.viewingKey, keys.spendingPublicKey)).toBe(false);
  });
});

describe("metadata", () => {
  const token = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Hex;
  it("native layout: tag | 0xeeeeeeee | 0xEeee…EEeE | amount | dstChainId", () => {
    const md = encodeStealthMetadata({ viewTag: 0xab, token: "native", amount: 10n ** 18n, dstChainId: 10143 });
    expect(md.length).toBe(2 + 89 * 2);
    expect(md.slice(0, 12)).toBe("0xabeeeeeeee");
    expect(decodeStealthMetadata(md)).toEqual({ viewTag: 0xab, selector: "0xeeeeeeee", kind: "native", token: NATIVE_TOKEN, amount: 10n ** 18n, dstChainId: 10143n });
  });
  it("erc20 layout uses the transfer selector; dstChainId is optional", () => {
    const md = encodeStealthMetadata({ viewTag: 1, token, amount: 5_000_000n });
    expect(md.length).toBe(2 + 57 * 2);
    expect(decodeStealthMetadata(md)).toEqual({ viewTag: 1, selector: "0xa9059cbb", kind: "erc20", token, amount: 5_000_000n });
  });
  it("tag-only and unknown selectors decode partially; bad input is rejected", () => {
    expect(decodeStealthMetadata("0x7f")).toEqual({ viewTag: 0x7f });
    expect(decodeStealthMetadata("0x0123456789")).toEqual({ viewTag: 1, selector: "0x23456789", kind: "other" });
    expect(() => decodeStealthMetadata("0x")).toThrow();
    expect(() => encodeStealthMetadata({ viewTag: 256 })).toThrow();
    expect(() => encodeStealthMetadata({ viewTag: 1, amount: 1n })).toThrow();
  });
});

// ------------------------------------------------------------------ RPC (mocked at the transport only)

type Rpc = (method: string, params: any[]) => unknown;
const clientWith = (rpc: Rpc) =>
  createPublicClient({ transport: custom({ request: async ({ method, params }: { method: string; params: any[] }) => rpc(method, params) }) });

const ANNOUNCER = "0x55649E01B5Df198D18D95b5cc5051630cfD45564" as Hex;
const REGISTRY = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538" as Hex;

function announcementLog(block: bigint, logIndex: number, stealthAddress: Hex, ephemeralPubKey: Hex, metadata: Hex, schemeId = 1n) {
  const event = erc5564AnnouncerAbi[0];
  return {
    address: ANNOUNCER,
    topics: encodeEventTopics({ abi: [event], eventName: "Announcement", args: { schemeId, stealthAddress, caller: "0x00000000000000000000000000000000000000c0" } }),
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [ephemeralPubKey, metadata]),
    blockNumber: numberToHex(block),
    transactionHash: pad(numberToHex(block * 1000n + BigInt(logIndex)), { size: 32 }),
    transactionIndex: "0x0",
    blockHash: pad("0x01", { size: 32 }),
    logIndex: numberToHex(logIndex),
    removed: false,
  };
}

describe("scanAnnouncements", () => {
  it("finds only our announcements, in chunks, with private keys, decoded metadata and balances", async () => {
    const me = stealthKeysFromPrivateKeys(randKey(), randKey());
    const other = stealthKeysFromPrivateKeys(randKey(), randKey());
    const token = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Hex;
    const mine1 = generateStealthAddress(me.metaAddress);
    const mine2 = generateStealthAddress(me.metaAddress);
    const theirs = generateStealthAddress(other.metaAddress);
    const logs = [
      announcementLog(105n, 0, mine1.stealthAddress, mine1.ephemeralPublicKey, encodeStealthMetadata({ viewTag: mine1.viewTag, token: "native", amount: 7n, dstChainId: 11155111 })),
      announcementLog(130n, 1, theirs.stealthAddress, theirs.ephemeralPublicKey, encodeStealthMetadata({ viewTag: theirs.viewTag })),
      announcementLog(250n, 3, mine2.stealthAddress, mine2.ephemeralPublicKey, encodeStealthMetadata({ viewTag: mine2.viewTag, token, amount: 9n })),
    ];
    const ranges: [bigint, bigint][] = [];
    const client = clientWith((method, params) => {
      if (method === "eth_getLogs") {
        const f = params[0];
        const from = BigInt(f.fromBlock);
        const to = BigInt(f.toBlock);
        ranges.push([from, to]);
        expect(f.address.toLowerCase()).toBe(ANNOUNCER.toLowerCase());
        expect(BigInt(f.topics[1])).toBe(1n); // schemeId filter
        return logs.filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
      }
      if (method === "eth_getBalance") return params[0].toLowerCase() === mine1.stealthAddress.toLowerCase() ? "0x7" : "0x0";
      if (method === "eth_call") {
        expect(params[0].to.toLowerCase()).toBe(token.toLowerCase());
        const { args } = decodeFunctionData({ abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }], data: params[0].data ?? params[0].input });
        expect((args[0] as string).toLowerCase()).toBe(mine2.stealthAddress.toLowerCase());
        return encodeAbiParameters([{ type: "uint256" }], [9n]);
      }
      throw new Error(`unexpected ${method}`);
    });

    const found = await scanAnnouncements(client as any, ANNOUNCER, 100n, 299n, me, { chunk: 100n, withBalances: true });
    expect(ranges).toEqual([[100n, 199n], [200n, 299n]]);
    expect(found.map((m) => m.stealthAddress)).toEqual([mine1.stealthAddress, mine2.stealthAddress]);
    expect(found[0]).toMatchObject({ kind: "native", amount: 7n, dstChainId: 11155111n, balance: 7n, blockNumber: 105n, logIndex: 0 });
    expect(found[1]).toMatchObject({ kind: "erc20", token, amount: 9n, balance: 9n });
    for (const m of found) expect(addrOfKey(m.stealthPrivateKey!)).toBe(m.stealthAddress);

    // without the spending key: matches but no private keys
    const viewOnly = await scanAnnouncements(client as any, ANNOUNCER, 100n, 299n, { viewingKey: me.viewingKey, spendingPublicKey: me.spendingPublicKey });
    expect(viewOnly).toHaveLength(2);
    expect(viewOnly[0]!.stealthPrivateKey).toBeUndefined();
  });

  it("stealthBalance reads native without a token", async () => {
    const client = clientWith((method) => (method === "eth_getBalance" ? "0x2a" : (() => { throw new Error(method); })()));
    expect(await stealthBalance(client as any, KAT.stealthAddress as Hex)).toBe(42n);
    expect(await stealthBalance(client as any, KAT.stealthAddress as Hex, NATIVE_TOKEN)).toBe(42n);
  });
});

describe("ERC-6538 registry helpers", () => {
  it("registerKeys calldata carries scheme 1 and the 66 raw key bytes", () => {
    const data = buildRegisterKeysCalldata(SL_META);
    const { functionName, args } = decodeFunctionData({ abi: erc6538RegistryAbi, data });
    expect(functionName).toBe("registerKeys");
    expect(args).toEqual([1n, SL_META.slice(7)]);
  });
  it("stealthMetaAddressOf round-trips; empty means unregistered", async () => {
    let registered: Hex = "0x";
    const client = clientWith((method, params) => {
      if (method !== "eth_call") throw new Error(method);
      expect(params[0].to.toLowerCase()).toBe(REGISTRY.toLowerCase());
      const { functionName, args } = decodeFunctionData({ abi: erc6538RegistryAbi, data: params[0].data ?? params[0].input });
      expect(functionName).toBe("stealthMetaAddressOf");
      expect(args![1]).toBe(1n);
      return encodeFunctionResult({ abi: erc6538RegistryAbi, functionName: "stealthMetaAddressOf", result: registered });
    });
    const who = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex;
    expect(await readStealthMetaAddress(client as any, REGISTRY, who)).toBeNull();
    registered = SL_META.slice(7) as Hex;
    expect(await readStealthMetaAddress(client as any, REGISTRY, who)).toBe(SL_META);
  });
});
