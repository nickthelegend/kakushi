// pnpm deploy:local — deploy Kakushi to the local forks and seed a two-Maker market.
// Requires `pnpm stack:up` (three forks; the optional Arbitrum Sepolia / OP Sepolia forks of
// KAKUSHI_EXTRA_FORKS are used when they answer on their ports). Everything here is real
// contracts and real signed transactions on local forks; balances are funded with anvil
// cheat RPCs (labelled "local fork funding").
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { type Hex, parseUnits, maxUint256, zeroAddress, type PublicClient } from "viem";
import { CHAINS, type ChainKey, ETH_USD_FEED_MONAD_TESTNET, OPTIONAL_LOCAL_CHAINS, PROTOCOL } from "@kakushi/config";
import { DEPLOYMENTS_DIR, loadDeployments } from "@kakushi/config/deployments";
import { publicClient, walletClient, ebcAbi, mdcAbi, erc20Abi } from "@kakushi/sdk";
import { LOCAL_KEYS, localAccount } from "./local-accounts.ts";

process.env.KAKUSHI_NETWORK = "local";
const keys: ChainKey[] = ["monadTestnet", "sepolia", "baseSepolia"];

/** An optional fork is used only if it answers on its port with its own chain id. */
async function forkUp(k: ChainKey): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${CHAINS[k].localPort}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(2000),
    });
    const j = (await r.json()) as { result?: string };
    if (j.result !== undefined && Number(j.result) !== CHAINS[k].chainId) throw new Error(`port ${CHAINS[k].localPort} serves chain ${Number(j.result)}, not ${CHAINS[k].name}`);
    return j.result !== undefined;
  } catch (e) {
    if ((e as Error).message.startsWith("port ")) throw e;
    return false;
  }
}

function forge(role: "hub" | "spoke", port: number, script = "script/Deploy.s.sol") {
  execFileSync(
    "forge",
    ["script", script, "--rpc-url", `http://127.0.0.1:${port}`, "--broadcast", "--sender", localAccount("deployer").address, "--slow"],
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
  for (const k of OPTIONAL_LOCAL_CHAINS) {
    if (await forkUp(k)) keys.push(k);
    // no fork this run: drop any record from an earlier one so nothing watches a dead port
    else rmSync(`${DEPLOYMENTS_DIR}/local/${CHAINS[k].chainId}.json`, { force: true });
  }
  console.log(`local forks: ${keys.map((k) => CHAINS[k].shortName).join(", ")}`);
  for (const k of keys) {
    forge(k === "monadTestnet" ? "hub" : "spoke", CHAINS[k].localPort);
    // privacy layer (stealth registry/announcer/StealthPay + shielded pools); merges `privacy` into the record
    forge(k === "monadTestnet" ? "hub" : "spoke", CHAINS[k].localPort, "script/DeployPrivacy.s.sol");
  }
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
    // anvil's dev keys are public: on the real testnets people attach EIP-7702 delegations to
    // them, which the forks inherit (a "user" that forwards every incoming ETH elsewhere).
    // Clear any code so our local accounts are plain EOAs.
    for (const r of ["deployer", "makerA", "makerB", "user", "user2", "watchtower", "attester"] as const) {
      await rpc(pc, "anvil_setCode", [localAccount(r).address, "0x"]);
    }
    for (const r of ["makerA", "makerB", "user", "user2", "watchtower", "attester"] as const) {
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
    const refundFees: [ChainKey, Hex, bigint][] = [
      ["sepolia", CHAINS.sepolia.usdc.address, u("0.03")],
      ["monadTestnet", CHAINS.monadTestnet.usdc.address, u("0.03")],
      ["sepolia", zeroAddress, e("0.00005")],
      ["baseSepolia", zeroAddress, e("0.00005")],
    ];
    // optional spokes: USDC to and from Monad, native ETH to and from Sepolia (12 pairs with
    // both; EBC caps a Maker at 16, so the rest of the ETH mesh is left to the Maker console)
    for (const k of keys.filter((x) => OPTIONAL_LOCAL_CHAINS.includes(x))) {
      await reg(k, "monadTestnet", false, u(m.usdcWithholding[0]!), m.bps, u("1"), u("500"));
      await reg("monadTestnet", k, false, u(m.usdcWithholding[1]!), m.bps, u("1"), u("500"));
      await reg("sepolia", k, true, e("0.0001"), m.ethBps, e("0.001"), e("0.05"));
      await reg(k, "sepolia", true, e("0.0001"), m.ethBps, e("0.001"), e("0.05"));
      refundFees.push([k, CHAINS[k].usdc.address, u("0.03")], [k, zeroAddress, e("0.00005")]);
    }
    // refund fees (what a Maker keeps when returning an unroutable payment)
    for (const [k, tok, fee] of refundFees) {
      await send(() => w.writeContract({ chain: w.chain, account: acct, address: d.hub.ebc, abi: ebcAbi, functionName: "setRefundFee", args: [BigInt(CHAINS[k].chainId), tok, fee] }));
    }
    // Makers approve the PayoutRouter for USDC on every chain (fills pull from the Maker's EOA)
    for (const k of keys) {
      const wk = walletClient(k, LOCAL_KEYS[m.role], "local");
      const h = await wk.writeContract({ chain: wk.chain, account: acct, address: CHAINS[k].usdc.address, abi: erc20Abi, functionName: "approve", args: [d.chains[CHAINS[k].chainId]!.payoutRouter, maxUint256] });
      await publicClient(k, "local").waitForTransactionReceipt({ hash: h });
    }
    console.log(`${m.name} ${acct.address}: 2000 USDC margin, ${4 + 4 * (keys.length - 3)} pairs`);
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
