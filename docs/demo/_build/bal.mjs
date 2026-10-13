import fs from "node:fs"; import path from "node:path";
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const ROOT = path.resolve(import.meta.dirname, "../../..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.testnet"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const dep = privateKeyToAccount(env.DEPLOYER_PK.startsWith("0x") ? env.DEPLOYER_PK : `0x${env.DEPLOYER_PK}`).address;
const rec = privateKeyToAccount(JSON.parse(fs.readFileSync(path.join(ROOT, ".stack/recording-wallet.json"))).pk).address;
const m = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const s = createPublicClient({ transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
for (const [n, a] of [["deployer", dep], ["recording", rec]]) {
  const u = await m.readContract({ address: "0x534b2f3A21130d7a60830c2Df862319e593943A3", abi: erc20Abi, functionName: "balanceOf", args: [a] });
  console.log(n, a, "MON", formatEther(await m.getBalance({ address: a })), "USDC", formatUnits(u, 6), "SepETH", formatEther(await s.getBalance({ address: a })));
}
