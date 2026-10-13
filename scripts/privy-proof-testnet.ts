// Privy proof on Monad testnet: the Maker's policy-fenced Privy server wallet signs an allowed
// transaction (USDC.approve to the PayoutRouter, so it can fill) that lands on chain, and Privy refuses
// a disallowed one (moving the USDC anywhere else), which never reaches the chain.
//
//   set -a; . ./.env.testnet; set +a; node scripts/privy-proof-testnet.ts
//
// Needs PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_MAKER_WALLET_ID / PRIVY_MAKER_WALLET_ADDRESS (never
// printed). Costs one approve's gas from the Privy wallet. Evidence: docs/evidence/testnet-privy.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, erc20Abi, maxUint256, type Hex } from "viem";
import { CHAINS } from "@kakushi/config";
import { publicClient } from "@kakushi/sdk";
import { makerSigner } from "../packages/maker/src/signer.ts";

const { account, kind } = makerSigner();
if (kind !== "privy") throw new Error("set the PRIVY_* variables (source the gitignored .env.testnet)");
const pc = publicClient("monadTestnet", "testnet");
const dep = JSON.parse(readFileSync(new URL("../config/generated/deployments.testnet.json", import.meta.url), "utf8"));
const router = dep.hub.payoutRouter as Hex;
const usdc = CHAINS.monadTestnet.usdc.address;

async function signed(to: Hex, data: Hex): Promise<Hex> {
  const [nonce, est, price] = await Promise.all([pc.getTransactionCount({ address: account.address, blockTag: "pending" }), pc.estimateGas({ account: account.address, to, data }), pc.getGasPrice()]);
  return account.signTransaction!({ chainId: 10143, type: "legacy", nonce, to, data, gas: (est * 115n) / 100n, gasPrice: (price * 110n) / 100n }); // Monad bills the limit
}

// 1. allowed: approve the PayoutRouter (the Maker needs it to fill)
const raw = await signed(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, maxUint256] }));
const hash = await pc.sendRawTransaction({ serializedTransaction: raw });
const rc = await pc.waitForTransactionReceipt({ hash });
console.log(`${rc.status === "success" ? "PASS" : "FAIL"}  Privy signed USDC.approve(PayoutRouter) from ${account.address}: ${hash}`);

// 2. refused: send the USDC to an outside address
let refused = "";
try {
  await signed(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 1n] }));
} catch (e) {
  refused = (e as Error).message.split("\n")[0]!.slice(0, 200);
}
console.log(`${refused ? "PASS" : "FAIL"}  Privy refused USDC.transfer to an outside address: ${refused || "it signed it"}`);

mkdirSync(new URL("../docs/evidence/", import.meta.url), { recursive: true });
writeFileSync(new URL("../docs/evidence/testnet-privy.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), chainId: 10143, wallet: account.address, allowedTx: hash, allowedStatus: rc.status, refusedTransfer: refused }, null, 2));
process.exit(rc.status === "success" && refused ? 0 : 1);
