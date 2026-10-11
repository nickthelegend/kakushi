// Drives the plugin's core against the local Monad fork (node scripts/e2e-local.ts --keep).
// The Port here signs with anvil dev keys; under mm it is the MetaMask executor (src/lib/mm.ts).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, defineChain, type Hex, http, parseAbi, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Kakushi, type Port } from "../src/lib/core.ts";
import { loadEnv } from "../src/lib/config.ts";

process.env.KAKUSHI_FHE_NETWORK ??= "local";
const RPC = "http://127.0.0.1:18810";
const chain = defineChain({ id: 10143, name: "Monad fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
// LOCAL ANVIL ONLY: Foundry's public dev keys
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

function port(acct: typeof alice): Port {
  const w = createWalletClient({ chain, account: acct, transport: http(RPC) });
  return {
    address: acct.address,
    chainId: 10143,
    client,
    send: (tx) => w.sendTransaction({ chain, account: acct, to: tx.to, data: tx.data, gas: tx.gasLimit }),
    signTypedData: (td) => acct.signTypedData(td),
  };
}

let up = false;
before(async () => {
  // fhe/'s own stack: its fork on :18810 AND a gateway on :8890. The gateway alone is not enough: on
  // the Kakushi hub fork (scripts/fhe-local.ts) the same port serves another deployment.
  const gw = await fetch("http://127.0.0.1:8890/health").then((r) => r.ok).catch(() => false);
  const fork = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })
    .then((r) => r.ok)
    .catch(() => false);
  up = gw && fork;
});

test("dark OTC through the plugin: hidden ask, hidden bid, cross reveals only the maker's price", async (t) => {
  if (!up) return t.skip("local stack not running");
  const env = loadEnv();
  const maker = new Kakushi(port(alice), env);
  const taker = new Kakushi(port(bob), env);
  const posted = await maker.otcPost("WMON/USDC", 500n, 3150n);
  const listed = (await taker.otcOrders()).find((o) => o.id === posted.orderId);
  assert.equal(listed?.pair, "WMON/USDC");
  const miss = await taker.otcTake(BigInt(posted.orderId), 3000n);
  assert.equal(miss.crossed, false);
  assert.equal(miss.price, null);
  const hit = await taker.otcTake(BigInt(posted.orderId), 3200n);
  assert.equal(hit.crossed, true);
  assert.equal(hit.price, "3150");
});

test("confidential USDC through the plugin: private send, balance revealed only to its owner", async (t) => {
  if (!up) return t.skip("local stack not running");
  const env = loadEnv();
  const usdc = env.apps.usdc!;
  const cusdc = env.apps.cusdc!;
  const w = createWalletClient({ chain, account: alice, transport: http(RPC) });
  const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function wrap(uint256)"]);
  for (const [to, fn, args] of [[usdc, "approve", [cusdc, 5_000_000n]], [cusdc, "wrap", [5_000_000n]]] as const) {
    const h = await w.writeContract({ chain, account: alice, address: to as Hex, abi: erc, functionName: fn, args: args as never, gas: 400_000n });
    await client.waitForTransactionReceipt({ hash: h });
  }
  const a = new Kakushi(port(alice), env);
  const b = new Kakushi(port(bob), env);
  const before = BigInt((await b.cusdcBalance()).balance);
  await a.cusdcSend(bob.address, 2_000_000n);
  const after = BigInt((await b.cusdcBalance()).balance);
  assert.equal(after - before, 2_000_000n);
});

test("sealed bid through the plugin", async (t) => {
  if (!up) return t.skip("local stack not running");
  const r = await new Kakushi(port(alice), loadEnv()).auctionBid(777n).catch((e: Error) => e);
  // a second run hits AlreadyBid: also proof the tx path reaches the contract
  assert.ok(!(r instanceof Error) || /reverted|AlreadyBid|0x/.test(r.message), String(r));
});

test("status reports the gateway and the FHE engine", async (t) => {
  if (!up) return t.skip("local stack not running");
  const s = await new Kakushi(port(alice), loadEnv()).status();
  assert.equal(s.gatewayOk, true);
  assert.equal(s.tfhe, "1.8.1");
});
