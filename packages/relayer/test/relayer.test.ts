import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import {
  type Hex,
  custom,
  getAddress,
  decodeFunctionData,
  encodeErrorResult,
  keccak256,
  numberToHex,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  RpcRequestError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FIELD_MODULUS, poolExecutor } from "@kakushi/sdk";
import { loadRelayerConfig, parsePools, type PoolConfig } from "../src/config.ts";
import { kakushiPoolAbi } from "../src/pool-abi.ts";
import { Relayer } from "../src/relayer.ts";
import { relayerServer } from "../src/server.ts";
import { RelayError, validateRelayRequest } from "../src/validate.ts";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const account = privateKeyToAccount(KEY);
const MONAD = 10143;
const POOL = "0xc0ffee254729296a45a3885639AC7E10F9d54979" as Hex;
const OTHER_POOL = "0x00000000000000000000000000000000000000AA" as Hex;
const pools: PoolConfig[] = [
  { chainId: MONAD, pool: POOL, minFee: 1000n, rpc: "http://rpc.invalid" },
  { chainId: 11155111, pool: OTHER_POOL, minFee: 5n, rpc: "http://rpc.invalid" },
];
const RECIPIENT = "0x00000000000000000000000000000000000000bb" as Hex;

const body = (over: Record<string, unknown> = {}, args: Record<string, unknown> = {}) => ({
  chainId: MONAD,
  pool: POOL,
  proof: `0x${"ab".repeat(512)}`,
  args: {
    root: `0x${"11".repeat(32)}`,
    nullifierHash: `0x${"22".repeat(32)}`,
    recipient: RECIPIENT,
    relayer: account.address,
    fee: "1000",
    refund: "0",
    ...args,
  },
  ...over,
});

const ctx = { relayer: account.address, pools };
const reject = (b: unknown, re: RegExp) => {
  try {
    validateRelayRequest(b, ctx);
  } catch (e) {
    expect(e).toBeInstanceOf(RelayError);
    expect((e as RelayError).status).toBe(400);
    expect((e as Error).message).toMatch(re);
    return;
  }
  throw new Error("expected rejection");
};

describe("request validation", () => {
  it("accepts a well-formed request (args or publicInputs, decimal or hex fee)", () => {
    const r = validateRelayRequest(body(), ctx);
    expect(r).toMatchObject({ chainId: MONAD, pool: { pool: POOL }, args: { recipient: RECIPIENT, fee: 1000n, refund: 0n } });
    const b = body({}, { fee: "0x3e9" }) as any;
    b.publicInputs = b.args;
    delete b.args;
    b.chainId = "10143";
    expect(validateRelayRequest(b, ctx).args.fee).toBe(1001n);
  });
  it("only serves configured pools", () => {
    reject(body({ chainId: 1 }), /does not serve chain 1/);
    reject(body({ pool: OTHER_POOL }), /not a Kakushi pool .* on chain 10143/);
    reject(body({ pool: "0x1234" }), /pool must be an address/);
    reject(body({ chainId: -1 }), /chainId/);
  });
  it("checks the proof bytes", () => {
    reject(body({ proof: "0x" }), /proof/);
    reject(body({ proof: "0xabc" }), /proof/);
    reject(body({ proof: `0x${"00".repeat(48 * 1024 + 1)}` }), /larger than/);
  });
  it("roots and nullifier hashes must be bytes32 field elements", () => {
    reject(body({}, { root: "0x11" }), /root must be a 0x-prefixed bytes32/);
    reject(body({}, { nullifierHash: numberToHex(FIELD_MODULUS, { size: 32 }) }), /nullifierHash is not a BN254 field element/);
  });
  it("recipient, relayer, fee and refund must be consistent with this relayer", () => {
    reject(body({}, { recipient: "0x0000000000000000000000000000000000000000" }), /zero address/);
    reject(body({}, { recipient: POOL.toLowerCase() }), /must not be the pool/);
    reject(body({}, { relayer: RECIPIENT }), /relayer must be this relayer's address/);
    reject(body({}, { fee: "999" }), /below this pool's minimum 1000/);
    reject(body({}, { fee: "1.5" }), /fee must be a non-negative integer/);
    reject(body({}, { fee: -1 }), /fee must be/);
    reject(body({}, { fee: `0x1${"0".repeat(64)}` }), /exceeds uint256/);
    reject(body({}, { refund: "1" }), /refund must be 0/);
    reject({ ...body(), args: undefined }, /args \(or publicInputs\)/);
    reject([], /JSON object/);
  });
});

const TARGET = "0x00000000000000000000000000000000000000Dd".toLowerCase() as Hex;
const REFUND_TO = "0x00000000000000000000000000000000000000ee" as Hex;
const callBody = (call: Record<string, unknown> = {}, args: Record<string, unknown> = {}) => {
  const b = body({}, args) as any;
  if (!("recipient" in args)) delete b.args.recipient;
  b.call = { target: TARGET, data: "0xa9059cbb0000", refundTo: REFUND_TO, ...call };
  return b;
};

describe("private call validation", () => {
  it("accepts {call}: recipient defaults to the pool's executor", () => {
    const r = validateRelayRequest(callBody(), ctx);
    expect(r.call).toEqual({ target: getAddress(TARGET), data: "0xa9059cbb0000", refundTo: getAddress(REFUND_TO) });
    expect(r.args.recipient).toBe(poolExecutor(POOL));
    expect(validateRelayRequest(callBody({}, { recipient: poolExecutor(POOL).toLowerCase() }), ctx).args.recipient).toBe(poolExecutor(POOL));
    expect(validateRelayRequest(callBody({ data: "0x" }), ctx).call!.data).toBe("0x");
  });
  it("rejects malformed or unsafe calls", () => {
    reject(callBody({ target: "0x0000000000000000000000000000000000000000" }), /call.target must not be the zero address/);
    reject(callBody({ target: POOL }), /call.target must not be the pool/);
    reject(callBody({ target: "0x12" }), /call.target must be an address/);
    reject(callBody({ refundTo: "0x0000000000000000000000000000000000000000" }), /call.refundTo must not be the zero address/);
    reject(callBody({ refundTo: undefined }), /call.refundTo must be an address/);
    reject(callBody({ data: "0xabc" }), /call.data must be 0x-prefixed bytes/);
    reject(callBody({ data: 7 }), /call.data/);
    reject(callBody({ data: `0x${"00".repeat(16 * 1024 + 1)}` }), /call.data is larger than/);
    reject({ ...callBody(), call: [] }, /call must be an object/);
    reject(callBody({}, { recipient: RECIPIENT }), /recipient is the pool's executor/);
    reject(callBody({}, { refund: "1" }), /refund must be 0/);
    reject(callBody({}, { fee: "1" }), /below this pool's minimum/);
    // and a plain withdraw cannot target the executor
    reject(body({}, { recipient: poolExecutor(POOL) }), /must not be the pool's executor/);
  });
});

describe("config", () => {
  it("parses pools and rejects duplicates / bad entries", () => {
    expect(parsePools({ pools: [{ chainId: 10143, pool: POOL.toLowerCase(), minFee: "7" }] })).toEqual([{ chainId: 10143, pool: POOL, minFee: 7n }]);
    expect(() => parsePools([])).toThrow(/at least one pool/);
    expect(() => parsePools([{ chainId: 1, pool: POOL }, { chainId: 1, pool: POOL }])).toThrow(/duplicate/);
    expect(() => parsePools([{ chainId: 1, pool: POOL, minFee: "1e18" }])).toThrow(/minFee/);
  });
  it("loads env, defaults the port to 3715 and never echoes the key", () => {
    const cfg = loadRelayerConfig({ RELAYER_KEY: KEY, RELAYER_POOLS: JSON.stringify([{ chainId: MONAD, pool: POOL, minFee: "1" }]) });
    expect(cfg.port).toBe(3715);
    expect(cfg.account.address).toBe(account.address);
    const badKey = `${KEY}ff`;
    try {
      loadRelayerConfig({ RELAYER_KEY: badKey });
      throw new Error("expected failure");
    } catch (e) {
      expect((e as Error).message).toMatch(/RELAYER_KEY/);
      expect((e as Error).message).not.toContain(badKey.slice(2, 20));
    }
  });
});

// ------------------------------------------------------------------ JSON-RPC mocked at the transport

interface Chain {
  calls: string[];
  sent: Hex[];
  revert?: string;
  delayMs?: number;
}

function mockTransport(state: Chain) {
  return custom({
    async request({ method, params }: { method: string; params: any[] }) {
      state.calls.push(method);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      switch (method) {
        case "eth_chainId":
          return numberToHex(MONAD);
        case "eth_call":
        case "eth_estimateGas": {
          const tx = params[0];
          expect(tx.to.toLowerCase()).toBe(POOL.toLowerCase());
          expect(tx.from.toLowerCase()).toBe(account.address.toLowerCase());
          if (state.revert) {
            const data = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: [state.revert] });
            // what the http transport raises for a JSON-RPC error response {code: 3, message, data}
            throw new RpcRequestError({ body: { method }, url: "http://rpc.invalid", error: { code: 3, message: `execution reverted: ${state.revert}`, data } });
          }
          return method === "eth_call" ? "0x" : "0x30d40";
        }
        case "eth_getTransactionCount":
          return "0x5";
        case "eth_getBlockByNumber":
          return { number: "0x10", baseFeePerGas: "0x3b9aca00", timestamp: "0x6553f100", hash: `0x${"01".repeat(32)}`, transactions: [] };
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_gasPrice":
          return "0x77359400";
        case "eth_fillTransaction":
          // like most public nodes: not supported, viem falls back to filling the tx itself
          throw new RpcRequestError({ body: { method }, url: "http://rpc.invalid", error: { code: -32601, message: "the method eth_fillTransaction does not exist" } });
        case "eth_sendRawTransaction":
          state.sent.push(params[0]);
          return keccak256(params[0]);
        default:
          throw new Error(`unexpected RPC ${method}`);
      }
    },
  });
}

function relayerWith(state: Chain) {
  return new Relayer({ account, pools, transport: () => mockTransport(state), network: "testnet", log: () => {} });
}

describe("relaying", () => {
  it("simulates, then submits withdraw signed by the relayer key with exactly the requested args", async () => {
    const state: Chain = { calls: [], sent: [] };
    const r = relayerWith(state);
    const { txHash } = await r.relay(body());
    expect(state.calls.indexOf("eth_call")).toBeGreaterThanOrEqual(0);
    expect(state.calls.indexOf("eth_call")).toBeLessThan(state.calls.indexOf("eth_sendRawTransaction"));
    expect(state.sent).toHaveLength(1);
    const raw = state.sent[0]!;
    expect(txHash).toBe(keccak256(raw));
    const tx = parseTransaction(raw);
    expect(tx.to?.toLowerCase()).toBe(POOL.toLowerCase());
    expect(tx.chainId).toBe(MONAD);
    expect(tx.value ?? 0n).toBe(0n);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as any })).toBe(account.address);
    const { functionName, args } = decodeFunctionData({ abi: kakushiPoolAbi, data: tx.data! });
    expect(functionName).toBe("withdraw");
    const b = body();
    expect(args).toEqual([b.proof, b.args.root, b.args.nullifierHash, RECIPIENT, account.address, 1000n, 0n]);
  });

  it("a request with `call` simulates, then submits withdrawAndCall with exactly the bound call", async () => {
    const state: Chain = { calls: [], sent: [] };
    const { txHash } = await relayerWith(state).relay(callBody());
    expect(state.calls.indexOf("eth_call")).toBeLessThan(state.calls.indexOf("eth_sendRawTransaction"));
    const tx = parseTransaction(state.sent[0]!);
    expect(txHash).toBe(keccak256(state.sent[0]!));
    expect(tx.to?.toLowerCase()).toBe(POOL.toLowerCase());
    expect(tx.value ?? 0n).toBe(0n);
    const { functionName, args } = decodeFunctionData({ abi: kakushiPoolAbi, data: tx.data! });
    expect(functionName).toBe("withdrawAndCall");
    const b = callBody();
    expect(args).toEqual([b.proof, b.args.root, b.args.nullifierHash, account.address, 1000n, getAddress(TARGET), "0xa9059cbb0000", getAddress(REFUND_TO)]);
  });

  it("does not submit a private call whose simulation reverts", async () => {
    const state: Chain = { calls: [], sent: [], revert: "merchant closed" };
    const err = await relayerWith(state).relay(callBody()).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/withdrawAndCall would revert.*merchant closed/);
    expect(state.sent).toHaveLength(0);
  });

  it("does not submit when the eth_call simulation reverts", async () => {
    const state: Chain = { calls: [], sent: [], revert: "nullifier already spent" };
    const r = relayerWith(state);
    const err = await r.relay(body()).catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/would revert.*nullifier already spent/);
    expect(state.sent).toHaveLength(0);
    expect(state.calls).toEqual(["eth_call"]);
  });

  it("rejects invalid requests before any RPC call", async () => {
    const state: Chain = { calls: [], sent: [] };
    const err = await relayerWith(state).relay(body({}, { fee: "1" })).catch((e) => e);
    expect(err.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("refuses a second request for a nullifierHash that is still being relayed", async () => {
    const state: Chain = { calls: [], sent: [], delayMs: 5 };
    const r = relayerWith(state);
    const first = r.relay(body());
    const second = await r.relay(body({}, { fee: "2000" })).catch((e) => e);
    expect(second).toBeInstanceOf(RelayError);
    expect(second.status).toBe(409);
    await first;
    expect(state.sent).toHaveLength(1);
  });

  it("serializes submissions per chain (no nonce races)", async () => {
    const state: Chain = { calls: [], sent: [], delayMs: 2 };
    const r = relayerWith(state);
    await Promise.all([r.relay(body()), r.relay(body({}, { nullifierHash: `0x${"03".repeat(32)}` }))]);
    expect(state.sent).toHaveLength(2);
    const firstSend = state.calls.indexOf("eth_sendRawTransaction");
    const secondCall = state.calls.indexOf("eth_call", state.calls.indexOf("eth_call") + 1);
    expect(firstSend).toBeLessThan(secondCall);
  });

  it("info lists the address, minimum fee per pool and chains", () => {
    expect(relayerWith({ calls: [], sent: [] }).info()).toEqual({
      address: account.address,
      feeByPool: { "10143": { [POOL]: "1000" }, "11155111": { [OTHER_POOL]: "5" } },
      chains: [MONAD, 11155111],
    });
  });
});

describe("HTTP server", () => {
  const state: Chain = { calls: [], sent: [] };
  const server = relayerServer(relayerWith(state));
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("GET /health and /info", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, address: account.address });
    const info = await (await fetch(`${base}/info`)).json();
    expect(info.address).toBe(account.address);
    expect(info.feeByPool["10143"][POOL]).toBe("1000");
  });
  it("POST /relay returns the tx hash, or a 4xx with the reason", async () => {
    const ok = await fetch(`${base}/relay`, { method: "POST", body: JSON.stringify(body()) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).txHash).toBe(keccak256(state.sent[0]!));
    const bad = await fetch(`${base}/relay`, { method: "POST", body: JSON.stringify(body({}, { relayer: RECIPIENT })) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/relayer must be/);
    const notJson = await fetch(`${base}/relay`, { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
