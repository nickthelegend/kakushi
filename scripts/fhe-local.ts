// Kakushi Confidential (FHE) on Kakushi's local Monad hub fork (one chain for both engines).
//
//   node scripts/fhe-local.ts up [--redeploy-apps] [--decrypt-at finalized]
//   node scripts/fhe-local.ts status
//   node scripts/fhe-local.ts down
//
// `up` needs the ZK stack first (`pnpm stack:up && pnpm deploy:local`): it reads the StealthAnnouncer
// from config/generated/deployments.local.json. It then, on the fork at KAKUSHI_FHE_RPC_URL
// (default http://127.0.0.1:18710, chain 10143), deploys the FHE core (registry at its CREATE3
// address via CreateX, executor, ACL, input verifier, decryption oracle), Kakushi Confidential tokens
// over the fork's REAL Circle USDC and Agora AUSD (KakushiPayToken), and ConfidentialStealthPay
// (stealth + FHE). It starts kakushi-fhe-engine (:8899) and the coprocessor + gateway + KMS (:8890)
// pointed at the fork, writes config/generated/fhe.local.json (gitignored) and records the PIDs in
// .stack/demo-pids as "fhe-engine <pid>" / "fhe-gateway <pid>". `down` stops exactly those PIDs.
// Re-running `up` reuses a live deployment and live services.
//
// LOCAL FORK ONLY: anvil cheat RPCs fund accounts. The FHE core must come from the registry's CREATE3
// deployer (KakushiConfig hard-codes the registry address), which is the Kakushi testnet deployer
// 0x2c76…C24C (fhe/contracts/registry-address.json). When DEPLOYER_PK for that address is in the
// environment (`set -a; . ./.env.testnet; set +a`), forge signs with it on the fork (read from the
// environment, never put on a command line); otherwise the fork impersonates the deployer, so the
// local stack needs no testnet key. Apps are deployed from anvil's public dev key #9. Keys stay in
// fhe/.secrets and fhe/.kakushi-fhe.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseAbi, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "@kakushi/config";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FHE = `${ROOT}fhe/`;
const RPC = process.env.KAKUSHI_FHE_RPC_URL ?? "http://127.0.0.1:18710";
const ENGINE_PORT = Number(process.env.KAKUSHI_FHE_ENGINE_PORT ?? 8899);
const GATEWAY_PORT = Number(process.env.KAKUSHI_FHE_GATEWAY_PORT ?? 8890);
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const NETWORK = "hub-local"; // coprocessor cursor + forge deployment file name (distinct from fhe/'s own 18810 stack)
const OUT_JSON = `${ROOT}config/generated/fhe.local.json`;
const CORE_JSON = `${FHE}contracts/deployments/${NETWORK}.json`;
const PIDS = `${ROOT}.stack/demo-pids`;
const CRE_FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192"; // Chainlink MockKeystoneForwarder on Monad testnet
const USDC = CHAINS.monadTestnet.usdc.address as Hex; // Circle USDC on Monad testnet
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Hex; // Agora AUSD on Monad testnet
const AUSD_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Hex;
// LOCAL ANVIL ONLY: Foundry's public dev keys. #9 deploys the apps; #4 / #6 are the app's labelled local accounts.
const APP_DEPLOYER_KEY: Hex = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const APP_ACCOUNTS: Hex[] = ["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "0x976EA74026E726554dB657fA54763abd0C3a0aa9"];

export interface FheLocalDeployment {
  network: "local";
  chainId: number;
  rpc: string;
  deployBlock: number;
  core: { registry: Hex; acl: Hex; executor: Hex; inputVerifier: Hex; oracle: Hex; creForwarder: Hex };
  tokens: { key: string; name: string; symbol: string; address: Hex; underlying: Hex; underlyingSymbol: string; decimals: number }[];
  stealthPay: Hex;
  stealthAnnouncer: Hex;
  gateway: string;
  engine: string;
  decryptAt: "latest" | "finalized";
  deployedAt: string;
}

const chain = defineChain({ id: 10143, name: "Monad testnet (Kakushi hub fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`  ${m}`);
const art = (file: string, name: string) => JSON.parse(readFileSync(`${FHE}contracts/out/${file}/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const registryAbi = parseAbi(["function config() view returns ((address acl, address executor, address inputVerifier, address oracle))"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// ------------------------------------------------------------------ demo-pids bookkeeping

function pidLines(): string[] {
  return existsSync(PIDS) ? readFileSync(PIDS, "utf8").split("\n").filter(Boolean) : [];
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function tracked(name: string): number | null {
  const hit = pidLines().reverse().find((l) => l.split(" ")[0] === name);
  const pid = hit ? Number(hit.split(" ")[1]) : NaN;
  return Number.isFinite(pid) && alive(pid) ? pid : null;
}

async function healthy(url: string): Promise<any | null> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
}
async function until(what: string, fn: () => Promise<boolean>, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await sleep(400);
  }
  throw new Error(`timeout: ${what}`);
}

/** A detached service that outlives this script; its PID goes to .stack/demo-pids. */
function startService(name: string, cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): number {
  mkdirSync(`${ROOT}.stack`, { recursive: true });
  const out = openSync(`${ROOT}.stack/${name}.log`, "w");
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", out, out], detached: true });
  p.unref();
  if (!p.pid) throw new Error(`${name} did not start`);
  appendFileSync(PIDS, `${name} ${p.pid}\n`);
  return p.pid;
}

// ------------------------------------------------------------------ chain helpers

async function hasCode(a: Hex) {
  const c = await pub.getCode({ address: a }).catch(() => undefined);
  return Boolean(c && c !== "0x");
}

/** Clear real-testnet EIP-7702 delegations (sweeper bots) that anvil dev keys carry on a Monad fork. */
async function clearDelegation(a: Hex) {
  const c = await pub.getCode({ address: a });
  if (c && c.toLowerCase().startsWith("0xef0100")) await rpc("anvil_setCode", [a, "0x"]);
}

async function fund(a: Hex, wei = 10n ** 21n) {
  const b = await pub.getBalance({ address: a });
  if (b < wei / 10n) await rpc("anvil_setBalance", [a, `0x${wei.toString(16)}`]);
}

async function deploy(file: string, name: string, args: unknown[]): Promise<Hex> {
  const a = art(file, name);
  const w = createWalletClient({ chain, account: privateKeyToAccount(APP_DEPLOYER_KEY), transport: http(RPC) });
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain, account: w.account, gas: 8_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`deploy ${name} failed`);
  return getAddress(rc.contractAddress);
}

// ------------------------------------------------------------------ up

async function up() {
  const decryptAt = process.argv.join(" ").includes("--decrypt-at finalized") ? "finalized" : "latest";
  const id = await pub.getChainId().catch(() => null);
  if (id !== 10143) throw new Error(`no Monad testnet fork at ${RPC} (chain ${id}); start the ZK stack first: pnpm stack:up && pnpm deploy:local`);
  const zkPath = `${ROOT}config/generated/deployments.local.json`;
  if (!existsSync(zkPath)) throw new Error("config/generated/deployments.local.json missing: run pnpm deploy:local first");
  const zk = JSON.parse(readFileSync(zkPath, "utf8"));
  const announcer = zk.hub?.privacy?.stealthAnnouncer as Hex | undefined;
  if (!announcer || !(await hasCode(announcer))) throw new Error("Kakushi's StealthAnnouncer is not on this fork: run pnpm deploy:local first");

  console.log(`Kakushi Confidential on the hub fork ${RPC}`);
  const engineBin = [`${FHE}engine/bin/kakushi-fhe-engine`, `${process.env.HOME}/.cache/kakushi-fhe-target/release/kakushi-fhe-engine`].find((p) => existsSync(p));
  if (!engineBin) throw new Error("kakushi-fhe-engine not built: cd fhe/engine && cargo build --release (CARGO_TARGET_DIR=~/.cache/kakushi-fhe-target)");
  if (!existsSync(`${FHE}.secrets/signers.json`)) throw new Error("fhe/.secrets/signers.json missing (input + KMS signer keys)");
  if (!existsSync(`${FHE}.kakushi-fhe/keys/public_key.bin`)) throw new Error("fhe/.kakushi-fhe/keys missing: run the engine keygen (fhe/README.md)");

  log("forge build (fhe/contracts)");
  execFileSync("forge", ["build"], { cwd: `${FHE}contracts`, stdio: ["ignore", "ignore", "inherit"] });

  const secrets = JSON.parse(readFileSync(`${FHE}.secrets/signers.json`, "utf8"));
  const reg = JSON.parse(readFileSync(`${FHE}contracts/registry-address.json`, "utf8"));
  const deployer = privateKeyToAccount(APP_DEPLOYER_KEY).address;
  for (const a of [deployer, ...APP_ACCOUNTS]) await clearDelegation(a);
  for (const a of [reg.deployer, secrets.relayer.address, deployer, ...APP_ACCOUNTS] as Hex[]) await fund(a);

  // ---- core: once per fork lifetime (the registry is CREATE3, so it cannot be redeployed)
  const prev: FheLocalDeployment | null = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, "utf8")) : null;
  let core: FheLocalDeployment["core"];
  let deployBlock: number;
  let fresh = false;
  if (await hasCode(reg.registry)) {
    const c = await pub.readContract({ address: reg.registry, abi: registryAbi, functionName: "config" });
    core = { registry: reg.registry, acl: c.acl, executor: c.executor, inputVerifier: c.inputVerifier, oracle: c.oracle, creForwarder: prev?.core.creForwarder ?? CRE_FORWARDER };
    const same = prev && prev.core.executor.toLowerCase() === c.executor.toLowerCase();
    deployBlock = same ? prev.deployBlock : Number(await pub.getBlockNumber());
    log(`core already on the fork: registry ${core.registry}, executor ${core.executor}${same ? "" : " (not ours: following from now)"}`);
  } else {
    const pk = process.env.DEPLOYER_PK as Hex | undefined;
    const signs = Boolean(pk && /^0x[0-9a-fA-F]{64}$/.test(pk) && privateKeyToAccount(pk).address.toLowerCase() === String(reg.deployer).toLowerCase());
    log(`deploying the FHE core (registry via CreateX CREATE3, executor, ACL, input verifier, oracle) as ${reg.deployer} (${signs ? "signed with DEPLOYER_PK" : "impersonated on the fork"})`);
    if (!signs) await rpc("anvil_impersonateAccount", [reg.deployer]);
    const env: Record<string, string | undefined> = { ...process.env };
    if (!signs) delete env.DEPLOYER_PK; // a key for another address would fail the script's DEPLOYER check
    execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", ...(signs ? [] : ["--unlocked"]), "--sender", reg.deployer], {
      cwd: `${FHE}contracts`,
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...env,
        DEPLOYER: reg.deployer,
        INPUT_SIGNERS: secrets.inputSigners.map((s: { address: string }) => s.address).join(","),
        KMS_SIGNERS: secrets.kmsSigners.map((s: { address: string }) => s.address).join(","),
        REGISTRY_SALT: reg.salt,
        CRE_FORWARDER,
        KAKUSHI_FHE_NETWORK: NETWORK,
      },
    });
    if (!signs) await rpc("anvil_stopImpersonatingAccount", [reg.deployer]);
    const d = JSON.parse(readFileSync(CORE_JSON, "utf8"));
    if (d.registry.toLowerCase() !== reg.registry.toLowerCase()) throw new Error("registry not at its CREATE3 address");
    core = { registry: d.registry, acl: d.acl, executor: d.executor, inputVerifier: d.inputVerifier, oracle: d.oracle, creForwarder: d.creForwarder };
    deployBlock = Number(d.deployBlock);
    fresh = true;
    log(`registry ${core.registry} (same address on every chain) · executor ${core.executor}`);
  }
  // the coprocessor reads this file (KAKUSHI_FHE_DEPLOYMENT)
  writeFileSync(CORE_JSON, JSON.stringify({ ...core, chainId: 10143, deployBlock }, null, 2));

  // ---- apps: Kakushi Confidential tokens over real fork stablecoins, and the stealth router
  const reuse = !fresh && !process.argv.includes("--redeploy-apps") && prev && prev.core.executor.toLowerCase() === core.executor.toLowerCase() && (await hasCode(prev.stealthPay)) && (await Promise.all(prev.tokens.map((t) => hasCode(t.address)))).every(Boolean) && prev.stealthAnnouncer.toLowerCase() === announcer.toLowerCase();
  let tokens: FheLocalDeployment["tokens"];
  let stealthPay: Hex;
  if (reuse) {
    tokens = prev!.tokens;
    stealthPay = prev!.stealthPay;
    log(`apps already deployed: ${tokens.map((t) => `${t.symbol} ${t.address}`).join(", ")}, ConfidentialStealthPay ${stealthPay}`);
  } else {
    tokens = [];
    const cusdc = await deploy("Examples.sol", "KakushiPayToken", [USDC, "Confidential USDC", "cUSDC"]);
    tokens.push({ key: "cUSDC", name: "Confidential USDC", symbol: "cUSDC", address: cusdc, underlying: USDC, underlyingSymbol: "USDC", decimals: 6 });
    if (await hasCode(AUSD)) {
      const causd = await deploy("Examples.sol", "KakushiPayToken", [AUSD, "Confidential AUSD", "cAUSD"]);
      tokens.push({ key: "cAUSD", name: "Confidential AUSD", symbol: "cAUSD", address: causd, underlying: AUSD, underlyingSymbol: "AUSD", decimals: 6 });
    }
    stealthPay = await deploy("ConfidentialStealthPay.sol", "ConfidentialStealthPay", [announcer]);
    log(`deployed ${tokens.map((t) => `${t.symbol} ${t.address}`).join(", ")}, ConfidentialStealthPay ${stealthPay}`);
  }

  // ---- local fork funding: real USDC (balance slot write) and real AUSD (Agora's faucet code)
  for (const a of APP_ACCOUNTS) {
    const u = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [a] });
    if (u < 1_000_000_000n) await rpc("anvil_dealERC20", [a, USDC, `0x${(10_000_000_000n).toString(16)}`]);
    if (tokens.some((t) => t.underlying === AUSD)) {
      const b = await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [a] });
      if (b < 1_000_000_000n) {
        const w = createWalletClient({ chain, account: privateKeyToAccount(APP_DEPLOYER_KEY), transport: http(RPC) });
        await rpc("evm_increaseTime", ["0x3d"]); // Agora's faucet has a 60 s global cooldown
        await rpc("evm_mine", []);
        const hash = await w.writeContract({ chain, account: w.account, address: AUSD_FAUCET, abi: parseAbi(["function requestFunds(address)"]), functionName: "requestFunds", args: [a], gas: 300_000n });
        await pub.waitForTransactionReceipt({ hash }).catch(() => undefined);
      }
    }
  }
  log(`funded the app's local accounts (${APP_ACCOUNTS.join(", ")}) with fork USDC${tokens.length > 1 ? " and AUSD" : ""}`);

  // ---- services
  if (fresh) rmSync(`${FHE}.kakushi-fhe/cursor-${NETWORK}.json`, { force: true });
  if (await healthy(ENGINE_URL)) log(`engine already answering on :${ENGINE_PORT}${tracked("fhe-engine") ? ` (pid ${tracked("fhe-engine")})` : " (not started by this script; left alone)"}`);
  else {
    const pid = startService("fhe-engine", engineBin, ["serve", "--dir", ".kakushi-fhe", "--port", String(ENGINE_PORT)], FHE);
    await until("engine", async () => Boolean(await healthy(ENGINE_URL)));
    log(`engine :${ENGINE_PORT} pid ${pid}`);
  }
  const gw = await healthy(GATEWAY_URL);
  if (gw) {
    if (String(gw.executor ?? "").toLowerCase() !== core.executor.toLowerCase()) throw new Error(`port ${GATEWAY_PORT} serves another FHE deployment (executor ${gw.executor}); stop it first`);
    log(`gateway already serving this deployment on :${GATEWAY_PORT}${tracked("fhe-gateway") ? ` (pid ${tracked("fhe-gateway")})` : ""}`);
  } else {
    const pid = startService("fhe-gateway", "node", ["src/main.ts"], `${FHE}coprocessor`, {
      KAKUSHI_FHE_NETWORK: NETWORK,
      KAKUSHI_FHE_DEPLOYMENT: CORE_JSON,
      RPC_URL: RPC,
      ENGINE_URL,
      GATEWAY_PORT: String(GATEWAY_PORT),
      DELIVER: "direct",
      // The shared hub fork keeps anvil's default epoch, so its `finalized` tag trails by 64 blocks
      // (about a minute). Locally the KMS signs at `latest`; pass --decrypt-at finalized to keep the gate.
      DECRYPT_AT: decryptAt,
    });
    await until("gateway", async () => Boolean(await healthy(GATEWAY_URL)));
    log(`coprocessor + gateway + KMS :${GATEWAY_PORT} pid ${pid} (decrypt at ${decryptAt})`);
  }

  const out: FheLocalDeployment = { network: "local", chainId: 10143, rpc: RPC, deployBlock, core, tokens, stealthPay, stealthAnnouncer: announcer, gateway: GATEWAY_URL, engine: ENGINE_URL, decryptAt, deployedAt: reuse && prev ? prev.deployedAt : new Date().toISOString() };
  mkdirSync(`${ROOT}config/generated`, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  log(`wrote config/generated/fhe.local.json`);
  status();
}

// ------------------------------------------------------------------ status / down

function status() {
  for (const name of ["fhe-engine", "fhe-gateway"]) {
    const pid = tracked(name);
    console.log(`${name.padEnd(12)} ${pid ? `pid ${pid} up` : "not running (or not started by this script)"}`);
  }
}

function down() {
  const keep: string[] = [];
  for (const l of pidLines()) {
    const [name, p] = l.split(" ");
    const pid = Number(p);
    if (name?.startsWith("fhe-") && Number.isFinite(pid)) {
      if (alive(pid)) {
        process.kill(pid, "SIGTERM");
        console.log(`stopped ${name} (${pid})`);
      }
      continue;
    }
    keep.push(l);
  }
  writeFileSync(PIDS, keep.length ? `${keep.join("\n")}\n` : "");
}

const cmd = process.argv[2] ?? "status";
if (cmd === "up") {
  up().catch((e) => {
    console.error(`fhe-local: ${(e as Error).message.split("\n")[0]}`);
    process.exit(1);
  });
} else if (cmd === "down") down();
else if (cmd === "status") status();
else {
  console.error("usage: node scripts/fhe-local.ts up [--redeploy-apps] [--decrypt-at finalized] | status | down");
  process.exit(2);
}
