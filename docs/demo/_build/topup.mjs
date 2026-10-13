import fs from "node:fs"; import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, erc20Abi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
const ROOT = path.resolve(import.meta.dirname, "../../..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.testnet"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const dep = privateKeyToAccount(env.DEPLOYER_PK.startsWith("0x") ? env.DEPLOYER_PK : `0x${env.DEPLOYER_PK}`);
const rec = privateKeyToAccount(JSON.parse(fs.readFileSync(path.join(ROOT, ".stack/recording-wallet.json"))).pk).address;
const monad = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } });
const sep = { ...sepolia, rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } } };
const out = [];
for (const [chain, f] of [[monad, async (pc, wc) => {
  const g = await pc.estimateGas({ account: dep, to: rec, value: parseEther("1.0") });
  out.push(["MON 1.0", await wc.sendTransaction({ to: rec, value: parseEther("1.0"), gas: (g * 115n) / 100n })]);
  const d = { address: "0x534b2f3A21130d7a60830c2Df862319e593943A3", abi: erc20Abi, functionName: "transfer", args: [rec, parseUnits("1", 6)], account: dep };
  const g2 = await pc.estimateContractGas(d);
  out.push(["USDC 1", await wc.writeContract({ ...d, gas: (g2 * 115n) / 100n })]);
}], [sep, async (pc, wc) => {
  out.push(["SepETH 0.003", await wc.sendTransaction({ to: rec, value: parseEther("0.003") })]);
}]]) {
  const pc = createPublicClient({ chain, transport: http() }); const wc = createWalletClient({ account: dep, chain, transport: http() });
  const n = out.length; await f(pc, wc);
  for (const [l, h] of out.slice(n)) console.log(l, h, (await pc.waitForTransactionReceipt({ hash: h })).status);
}
