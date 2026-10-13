// Generate (once) the recording wallet in .stack/recording-wallet.json (mode 600) and fund it from the deployer.
// Never prints a private key. Usage: node fund-wallet.mjs [--fund]
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, formatUnits, erc20Abi, defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const ROOT = path.resolve(import.meta.dirname, "../../..");
const F = path.join(ROOT, ".stack/recording-wallet.json");
if (!fs.existsSync(F)) {
  fs.writeFileSync(F, JSON.stringify({ pk: generatePrivateKey(), created: new Date().toISOString() }), { mode: 0o600 });
}
fs.chmodSync(F, 0o600);
const rec = privateKeyToAccount(JSON.parse(fs.readFileSync(F, "utf8")).pk);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.testnet"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const dep = privateKeyToAccount(env.DEPLOYER_PK.startsWith("0x") ? env.DEPLOYER_PK : `0x${env.DEPLOYER_PK}`);
const monad = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } });
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const pc = createPublicClient({ chain: monad, transport: http() });
const bal = async (a) => [formatEther(await pc.getBalance({ address: a })), formatUnits(await pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }), 6)];
console.log("recording", rec.address, await bal(rec.address));
console.log("deployer ", dep.address, await bal(dep.address));
if (process.argv.includes("--fund")) {
  const wc = createWalletClient({ account: dep, chain: monad, transport: http() });
  const g1 = await pc.estimateGas({ account: dep, to: rec.address, value: parseEther("1.5") });
  const h1 = await wc.sendTransaction({ to: rec.address, value: parseEther("1.5"), gas: (g1 * 115n) / 100n });
  console.log("MON tx", h1, (await pc.waitForTransactionReceipt({ hash: h1 })).status);
  const data = { address: USDC, abi: erc20Abi, functionName: "transfer", args: [rec.address, parseUnits("2", 6)], account: dep };
  const g2 = await pc.estimateContractGas(data);
  const h2 = await wc.writeContract({ ...data, gas: (g2 * 115n) / 100n });
  console.log("USDC tx", h2, (await pc.waitForTransactionReceipt({ hash: h2 })).status);
  console.log("recording", rec.address, await bal(rec.address));
}
