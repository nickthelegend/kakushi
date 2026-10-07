// pnpm deploy:local — deploy Kakushi to the three local forks and seed a two-Maker market.
// Requires `pnpm stack:up`. Everything here is real contracts and real signed transactions
// on local forks; balances are funded with anvil cheat RPCs (labelled "local fork funding").
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { type Hex, parseUnits, maxUint256, zeroAddress, type PublicClient } from "viem";
import { CHAINS, type ChainKey, ETH_USD_FEED_MONAD_TESTNET, PROTOCOL } from "@kakushi/config";
import { loadDeployments } from "@kakushi/config/deployments";
import { publicClient, walletClient, ebcAbi, mdcAbi, erc20Abi } from "@kakushi/sdk";
import { LOCAL_KEYS, localAccount } from "./local-accounts.ts";

process.env.KAKUSHI_NETWORK = "local";
const keys: ChainKey[] = ["monadTestnet", "sepolia", "baseSepolia"];

function forge(role: "hub" | "spoke", port: number) {
  execFileSync(
    "forge",
    ["script", "script/Deploy.s.sol", "--rpc-url", `http://127.0.0.1:${port}`, "--broadcast", "--sender", localAccount("deployer").address, "--slow"],
    {
      cwd: "packages/contracts",
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        DEPLOYER_PK: LOCAL_KEYS.deployer,
        KAKUSHI_ROLE: role,
        KAKUSHI_NETWORK: "local",
        KAKUSHI_FILL_WINDOW: String(PROTOCOL.fillWindow),
        KAKUSHI_DISPUTE_WINDOW: String(PROTOCOL.disputeWindow),
        KAKUSHI_CLOCK_SKEW: String(PROTOCOL.clockSkew),
        KAKUSHI_PARAM_DELAY: String(PROTOCOL.paramDelay),
      },
    },
  );
}

async function rpc(c: PublicClient, method: string, params: unknown[]) {
  return c.request({ method: method as never, params: params as never });
}

async function main() {
  const t0 = Date.now();
  for (const k of keys) forge(k === "monadTestnet" ? "hub" : "spoke", CHAINS[k].localPort);
  const d = loadDeployments("local");
  console.log(`deployed: hub ${d.hub.disputeModule} (DisputeModule), PayoutRouter ${d.hub.payoutRouter} on all chains`);

  const makers = [
    { role: "makerA" as const, name: "Maker A", usdcWithholding: ["0.05", "0.50", "0.50"], bps: 10n, ethBps: 30n },
    { role: "makerB" as const, name: "Maker B", usdcWithholding: ["0.03", "0.40", "0.40"], bps: 15n, ethBps: 25n },
  ];

  // local fork funding: USDC on every chain for makers and users
  for (const k of keys) {
    const c = CHAINS[k];
    const pc = publicClient(k, "local");
    for (const r of ["makerA", "makerB", "user", "user2", "watchtower"] as const) {
      const amt = r.startsWith("maker") ? parseUnits("20000", 6) : parseUnits("1000", 6);
      await rpc(pc, "anvil_dealERC20", [localAccount(r).address, c.usdc.address, `0x${amt.toString(16)}`]);
      await rpc(pc, "anvil_setBalance", [localAccount(r).address, `0x${parseUnits("100", 18).toString(16)}`]);
    }
  }

  const hub = publicClient("monadTestnet", "local");
  const usdcHub = CHAINS.monadTestnet.usdc.address;
  for (const m of makers) {
    const acct = localAccount(m.role);
    const w = walletClient("monadTestnet", LOCAL_KEYS[m.role], "local");
    const send = async (fn: () => Promise<Hex>) => {
      const h = await fn();
      const rc = await hub.waitForTransactionReceipt({ hash: h });
      if (rc.status !== "success") throw new Error(`tx failed ${h}`);
    };
    // margin on the hub (Monad USDC)
    await send(() => w.writeContract({ chain: w.chain, account: acct, address: usdcHub, abi: erc20Abi, functionName: "approve", args: [d.hub.mdc, maxUint256] }));
    await send(() => w.writeContract({ chain: w.chain, account: acct, address: d.hub.mdc, abi: mdcAbi, functionName: "depositMargin", args: [usdcHub, parseUnits("2000", 6)] }));

    const reg = async (srcKey: ChainKey, dstKey: ChainKey, native: boolean, withholding: bigint, bps: bigint, min: bigint, max: bigint) => {
      const src = CHAINS[srcKey];
      const dst = CHAINS[dstKey];
      await send(() =>
        w.writeContract({
          chain: w.chain,
          account: acct,
          address: d.hub.ebc,
          abi: ebcAbi,
          functionName: "registerPair",
          args: [
            { maker: acct.address, srcChainId: BigInt(src.chainId), srcToken: native ? zeroAddress : src.usdc.address, dstChainId: BigInt(dst.chainId), dstToken: native ? zeroAddress : dst.usdc.address, identCode: dst.identCode },
            { effectiveFrom: 0n, withholdingFee: withholding, tradingFeeBps: Number(bps), minAmount: min, maxAmount: max },
            { marginToken: usdcHub, priceFeed: native ? ETH_USD_FEED_MONAD_TESTNET : zeroAddress, srcDecimals: native ? 18 : 6, set: true },
          ],
        }),
      );
    };
    const u = (x: string) => parseUnits(x, 6);
    const e = (x: string) => parseUnits(x, 18);
    await reg("sepolia", "monadTestnet", false, u(m.usdcWithholding[0]!), m.bps, u("1"), u("500"));
    await reg("monadTestnet", "sepolia", false, u(m.usdcWithholding[1]!), m.bps, u("1"), u("500"));
    await reg("sepolia", "baseSepolia", true, e("0.0001"), m.ethBps, e("0.001"), e("0.05"));
    await reg("baseSepolia", "sepolia", true, e("0.0001"), m.ethBps, e("0.001"), e("0.05"));
    // refund fees (what a Maker keeps when returning an unroutable payment)
    for (const [k, tok, fee] of [
      ["sepolia", CHAINS.sepolia.usdc.address, u("0.03")],
      ["monadTestnet", CHAINS.monadTestnet.usdc.address, u("0.03")],
      ["sepolia", zeroAddress, e("0.00005")],
      ["baseSepolia", zeroAddress, e("0.00005")],
    ] as const) {
      await send(() => w.writeContract({ chain: w.chain, account: acct, address: d.hub.ebc, abi: ebcAbi, functionName: "setRefundFee", args: [BigInt(CHAINS[k as ChainKey].chainId), tok as Hex, fee as bigint] }));
    }
    // Makers approve the PayoutRouter for USDC on every chain (fills pull from the Maker's EOA)
    for (const k of keys) {
      const wk = walletClient(k, LOCAL_KEYS[m.role], "local");
      const h = await wk.writeContract({ chain: wk.chain, account: acct, address: CHAINS[k].usdc.address, abi: erc20Abi, functionName: "approve", args: [d.chains[CHAINS[k].chainId]!.payoutRouter, maxUint256] });
      await publicClient(k, "local").waitForTransactionReceipt({ hash: h });
    }
    console.log(`${m.name} ${acct.address}: 2000 USDC margin, 4 pairs`);
  }

  // app/runtime config for the local network
  mkdirSync("config/generated", { recursive: true });
  writeFileSync("config/generated/deployments.local.json", JSON.stringify(d, null, 2));
  writeFileSync(
    "config/generated/makers.local.json",
    JSON.stringify([
      { name: "Maker A", address: localAccount("makerA").address, url: "http://127.0.0.1:3711" },
      { name: "Maker B", address: localAccount("makerB").address, url: "http://127.0.0.1:3712" },
    ], null, 2),
  );
  execFileSync("node", ["scripts/configure.ts", "local"], { cwd: "packages/cre", stdio: "inherit" });
  console.log(`local deployment ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
