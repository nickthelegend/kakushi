// Live bridge smoke test on public testnets: 0.5 USDC Monad testnet -> Ethereum Sepolia through the
// hosted Maker, end to end with real transactions.
//
//   set -a; . ./.env.testnet; set +a; node scripts/smoke-bridge-testnet.ts [--amount 0.5] [--reverse]
//
// The deployer (DEPLOYER_PK, never printed) asks every recorded Maker for a quote (config/generated/
// makers.testnet.json), keeps only quotes the hub's own classification agrees with, pays the best one
// with the destination's ident code in the last four digits, then waits for the Maker's Payout on the
// destination chain and checks the exact net amount arrived. --reverse runs Sepolia -> Monad instead
// (the paying account needs Sepolia USDC). Evidence goes to docs/evidence/testnet-bridge.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, formatUnits, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "@kakushi/config";
import { buildGross, buildTransferTx, erc20Abi, findPayout, findSourcePayment, publicClient, srcRefOf, walletClient } from "@kakushi/sdk";
import { kakushiFromDisk } from "@kakushi/sdk/node";

const pk = process.env.DEPLOYER_PK as Hex | undefined;
if (!pk) throw new Error("DEPLOYER_PK not set (source the gitignored .env.testnet)");
const me = privateKeyToAccount(pk);
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const reverse = process.argv.includes("--reverse");
const srcKey = reverse ? "sepolia" : "monadTestnet";
const dstKey = reverse ? "monadTestnet" : "sepolia";
const src = CHAINS[srcKey];
const dst = CHAINS[dstKey];
const amount = parseUnits(arg("amount", "0.5"), 6);

const k = kakushiFromDisk("testnet");
const makers = JSON.parse(readFileSync(new URL("../config/generated/makers.testnet.json", import.meta.url), "utf8")) as { name: string; url: string }[];
const sc = publicClient(srcKey, "testnet");
const dc = publicClient(dstKey, "testnet");
const w = walletClient(srcKey, pk, "testnet");
const bal = (c: typeof sc, token: Hex) => c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [me.address] }) as Promise<bigint>;

console.log(`${src.name} -> ${dst.name}: ${formatUnits(amount, 6)} USDC from ${me.address}`);
const quotes = await k.quote({ srcChainId: src.chainId, dstChainId: dst.chainId, token: "USDC", amount, makerUrls: makers.map((m) => m.url) });
for (const q of quotes) console.log(`  quote ${q.name}: net ${formatUnits(BigInt(q.net), 6)} USDC, eta ${q.etaMs} ms${q.quotable ? "" : ` (not quotable: ${q.reason})`}`);
const best = quotes.find((q) => q.quotable);
if (!best) throw new Error("no quotable Maker");

const { gross } = buildGross(amount, dst.chainId);
const tx = buildTransferTx(k, { srcChainId: src.chainId, token: src.usdc.address, maker: best.maker as Hex, gross, sender: me.address });
const before = await bal(dc, dst.usdc.address);
const mark = await dc.getBlockNumber();
const data = tx.data ?? encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [best.maker as Hex, gross] });
const gas = ((await sc.estimateGas({ account: me, to: tx.to as Hex, data })) * 115n) / 100n; // Monad bills the limit
const hash = await w.sendTransaction({ chain: w.chain, account: me, to: tx.to as Hex, data, gas });
const rc = await sc.waitForTransactionReceipt({ hash });
const sentAt = Date.now();
console.log(`PASS  paid ${gross} units (code ${gross % 10_000n}) to ${best.name}: ${hash} (block ${rc.blockNumber})`);
const p = await findSourcePayment(k, src.chainId, hash);
if (!p) throw new Error("the source payment was not recognized");

let payout = null;
const deadline = Date.now() + 180_000;
while (!payout && Date.now() < deadline) {
  payout = await findPayout(dc, k.deployment(dst.chainId).payoutRouter, srcRefOf(p), best.maker as Hex, mark).catch(() => null);
  if (!payout) await new Promise((r) => setTimeout(r, 2000));
}
if (!payout) throw new Error(`no Payout on ${dst.name} within 180 s`);
const got = (await bal(dc, dst.usdc.address)) - before;
const ok = got === BigInt(best.net);
const secs = ((Date.now() - sentAt) / 1000).toFixed(1);
console.log(`${ok ? "PASS" : "FAIL"}  ${best.name} paid ${formatUnits(got, 6)} USDC on ${dst.name} ${secs} s after the source receipt: ${payout.txHash}`);

mkdirSync(new URL("../docs/evidence/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../docs/evidence/testnet-bridge${reverse ? "-reverse" : ""}.json`, import.meta.url),
  JSON.stringify({ at: new Date().toISOString(), from: me.address, src: src.chainId, dst: dst.chainId, maker: best.maker, makerName: best.name, gross: gross.toString(), net: best.net, received: got.toString(), sourceTx: hash, payoutTx: payout.txHash, secondsAfterSourceReceipt: Number(secs), pass: ok }, null, 2),
);
process.exit(ok ? 0 : 1);
