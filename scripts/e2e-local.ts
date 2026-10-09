// End-to-end on a local Monad-testnet fork with REAL tfhe-rs ciphertexts.
//   node scripts/e2e-local.ts [--keep] [--deliver cre]
// Starts: anvil fork (:18810), fhish-engine (:8899), coprocessor+gateway (:8890). Stops them unless --keep.
// --deliver cre: the coprocessor only signs results; every callback is delivered by the local CRE
// runner (cre/local/runner.ts, :8891) through Chainlink's MockKeystoneForwarder -> oracle.onReport.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, openSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEventLogs, defineChain, type Hex, parseAbi, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FhishClient, waitForDecryption } from "../sdk/src/index.ts";
import { nativeEncryptor } from "../sdk/src/node.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 18810;
const RPC = `http://127.0.0.1:${PORT}`;
const GATEWAY = "http://127.0.0.1:8890";
const ENGINE_BIN = `${ROOT}engine/bin/fhish-engine`;
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3"; // Circle USDC on Monad testnet
const keep = process.argv.includes("--keep");
const viaCre = process.argv.join(" ").includes("--deliver cre");
const CRE_FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192"; // Chainlink MockKeystoneForwarder on Monad testnet
const procs: ChildProcess[] = [];
const results: { name: string; pass: boolean; detail: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);
// LOCAL ANVIL ONLY: Foundry's public dev keys
const KEYS = {
  alice: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  bob: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  carol: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

function start(name: string, cmd: string, args: string[], env: Record<string, string> = {}, cwd = ROOT) {
  mkdirSync(`${ROOT}.stack`, { recursive: true });
  const out = openSync(`${ROOT}.stack/${name}.log`, "w");
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
  procs.push(p);
  return p;
}
async function until(what: string, fn: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await sleep(300);
  }
  throw new Error(`timeout: ${what}`);
}

const chain = defineChain({ id: 10143, name: "Monad testnet (local fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
const art = (file: string, name: string) => JSON.parse(readFileSync(`${ROOT}contracts/out/${file}/${name}.json`, "utf8"));

async function deployApp(file: string, name: string, args: unknown[], from: keyof typeof KEYS) {
  const a = art(file, name);
  const w = createWalletClient({ chain, account: privateKeyToAccount(KEYS[from]), transport: http(RPC) });
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain, account: w.account });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { address: rc.contractAddress as Hex, abi: a.abi };
}
function wallet(k: keyof typeof KEYS) {
  return createWalletClient({ chain, account: privateKeyToAccount(KEYS[k]), transport: http(RPC) });
}
async function send(k: keyof typeof KEYS, address: Hex, abi: any, functionName: string, args: unknown[]) {
  const w = wallet(k);
  const hash = await w.writeContract({ chain, account: w.account, address, abi, functionName, args, gas: 3_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted`);
  return rc;
}

async function main() {
  const t0 = Date.now();
  say("1 · local Monad-testnet fork, engine, deploy, coprocessor");
  // --slots-in-an-epoch 1: the fork's `finalized` tag trails latest by 2 blocks, like Monad (~2-3)
  start("anvil", "anvil", ["--port", String(PORT), "--fork-url", process.env.MONAD_FORK_URL ?? "https://rpc-testnet.monadinfra.com", "--block-time", "1", "--slots-in-an-epoch", "1", "--prune-history", "300", "--silent"]);
  await until("anvil", async () => (await pub.getChainId()) === 10143);
  const secrets = JSON.parse(readFileSync(`${ROOT}.secrets/signers.json`, "utf8"));
  const reg = JSON.parse(readFileSync(`${ROOT}contracts/registry-address.json`, "utf8"));
  // anvil dev keys carry real-testnet EIP-7702 delegations (sweeper bots): clear them on the fork
  for (const k of Object.values(KEYS)) await rpc("anvil_setCode", [privateKeyToAccount(k).address, "0x"]);
  for (const a of [reg.deployer, secrets.relayer.address, ...Object.values(KEYS).map((k) => privateKeyToAccount(k).address)]) {
    await rpc("anvil_setBalance", [a, "0x56BC75E2D63100000"]);
  }
  await rpc("anvil_impersonateAccount", [reg.deployer]);
  execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "--unlocked", "--sender", reg.deployer], {
    cwd: `${ROOT}contracts`,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      DEPLOYER: reg.deployer,
      INPUT_SIGNERS: secrets.inputSigners.map((s: any) => s.address).join(","),
      KMS_SIGNERS: secrets.kmsSigners.map((s: any) => s.address).join(","),
      REGISTRY_SALT: reg.salt,
      CRE_FORWARDER,
      FHISH_NETWORK: "local",
    },
  });
  const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local.json`, "utf8"));
  if (dep.registry.toLowerCase() !== reg.registry.toLowerCase()) throw new Error("registry not at its CREATE3 address");
  console.log(`  registry ${dep.registry} (same address on every chain) · executor ${dep.executor}`);
  if (!(await fetch("http://127.0.0.1:8899/health").then((r) => r.ok).catch(() => false))) {
    start("engine", ENGINE_BIN, ["serve", "--dir", ".fhish", "--port", "8899"]);
    await until("engine", async () => (await fetch("http://127.0.0.1:8899/health")).ok);
  }
  start("coprocessor", "node", ["src/main.ts"], { FHISH_NETWORK: "local", RPC_URL: RPC, DELIVER: viaCre ? "cre" : "direct" }, `${ROOT}coprocessor`);
  await until("gateway", async () => (await fetch(`${GATEWAY}/health`)).ok);
  if (viaCre) {
    start("cre-runner", "node", ["local/runner.ts"], { RPC_URL: RPC, GATEWAY_URL: GATEWAY, CRE_FROM_BLOCK: String(dep.deployBlock) }, `${ROOT}cre`);
    await until("cre runner", async () => (await fetch("http://127.0.0.1:8891/health")).ok);
    console.log(`  delivery: Chainlink CRE (local runner) through forwarder ${CRE_FORWARDER}`);
  }

  const fhish = new FhishClient({ gatewayUrl: GATEWAY, chainId: 10143, encryptor: nativeEncryptor(ENGINE_BIN), publicClient: pub as never });
  const addr = (k: keyof typeof KEYS) => privateKeyToAccount(KEYS[k]).address;

  // ---------------------------------------------------------------- sealed-bid auction
  try {
    say("2 · sealed-bid auction: three encrypted bids, only the winner is revealed");
    const auction = await deployApp("Examples.sol", "FhishAuction", ["Genesis hanko #1", 30n], "alice");
    const bids: [keyof typeof KEYS, bigint][] = [["alice", 420n], ["bob", 1337n], ["carol", 900n]];
    for (const [who, amount] of bids) {
      const enc = await fhish.encrypt("euint64", amount, auction.address, addr(who));
      await send(who, auction.address, auction.abi, "bid", [enc.handle, enc.proof]);
      console.log(`  ${who} bid (encrypt ${enc.ms.encrypt} ms, attest ${enc.ms.attest} ms) — the chain sees only ${enc.handle.slice(0, 18)}…`);
    }
    await rpc("evm_increaseTime", ["0x20"]);
    await rpc("evm_mine", []);
    const t = Date.now();
    const rc = await send("carol", auction.address, auction.abi, "close", []);
    const ev = parseEventLogs({ abi: parseAbi(["event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)"]), logs: rc.logs });
    await waitForDecryption(pub as never, dep.oracle, ev[0]!.args.requestId);
    const c = getContract({ address: auction.address, abi: auction.abi, client: pub });
    const [winner, price] = [await c.read.winner(), await c.read.price()];
    const ok = (winner as string).toLowerCase() === addr("bob").toLowerCase() && price === 1337n;
    // bob decrypts his own bid (ACL), nobody else's
    const mine = (await c.read.myBid({ account: addr("bob") })) as Hex;
    const dec = await fhish.userDecrypt([mine], auction.address, wallet("bob") as never);
    results.push({ name: "Sealed-bid auction", pass: ok && dec[mine.toLowerCase()] === 1337n, detail: `winner bob @ ${price}; close -> callback ${Date.now() - t} ms; bob user-decrypted his bid = ${dec[mine.toLowerCase()]}; losing bids never decrypted` });
  } catch (e) {
    results.push({ name: "Sealed-bid auction", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- confidential USDC
  try {
    say("3 · confidential USDC: wrap real Monad USDC, encrypted transfer, decrypt balance, unwrap");
    await rpc("anvil_dealERC20", [addr("alice"), USDC, "0x" + (100_000_000n).toString(16)]);
    const cusdc = await deployApp("Examples.sol", "ConfidentialWrappedToken", [USDC, "Confidential USDC", "cUSDC"], "alice");
    const erc = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
    await send("alice", USDC, erc, "approve", [cusdc.address, 50_000_000n]);
    await send("alice", cusdc.address, cusdc.abi, "wrap", [50_000_000n]);
    const amt = await fhish.encrypt("euint64", 20_000_000n, cusdc.address, addr("alice"));
    await send("alice", cusdc.address, cusdc.abi, "confidentialTransfer", [addr("bob"), amt.handle, amt.proof]);
    const c = getContract({ address: cusdc.address, abi: cusdc.abi, client: pub });
    const bobBal = (await c.read.confidentialBalanceOf([addr("bob")])) as Hex;
    const aliceBal = (await c.read.confidentialBalanceOf([addr("alice")])) as Hex;
    const b = await fhish.userDecrypt([bobBal], cusdc.address, wallet("bob") as never);
    const a = await fhish.userDecrypt([aliceBal], cusdc.address, wallet("alice") as never);
    // carol cannot read bob's balance
    let carolBlocked = false;
    await fhish.userDecrypt([bobBal], cusdc.address, wallet("carol") as never).catch(() => (carolBlocked = true));
    const un = await fhish.encrypt("euint64", 5_000_000n, cusdc.address, addr("bob"));
    const before = (await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [addr("bob")] })) as bigint;
    const rc = await send("bob", cusdc.address, cusdc.abi, "unwrap", [un.handle, un.proof]);
    const ev = parseEventLogs({ abi: parseAbi(["event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)"]), logs: rc.logs });
    await waitForDecryption(pub as never, dep.oracle, ev[0]!.args.requestId);
    const after = (await pub.readContract({ address: USDC, abi: erc, functionName: "balanceOf", args: [addr("bob")] })) as bigint;
    const pass = b[bobBal.toLowerCase()] === 20_000_000n && a[aliceBal.toLowerCase()] === 30_000_000n && carolBlocked && after - before === 5_000_000n;
    results.push({ name: "Confidential USDC (any ERC-20)", pass, detail: `bob sees 20 cUSDC, alice 30 cUSDC, carol refused; bob unwrapped 5 real USDC` });
  } catch (e) {
    results.push({ name: "Confidential USDC (any ERC-20)", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- dark OTC
  try {
    say("4 · dark OTC: encrypted limits; a miss reveals nothing, a cross reveals the price");
    const otc = await deployApp("Examples.sol", "FhishDarkOTC", [], "alice");
    const ask = await fhish.encrypt("euint64", 3_150n, otc.address, addr("alice"));
    await send("alice", otc.address, otc.abi, "post", ["WMON/USDC", 1000n, ask.handle, ask.proof]);
    const low = await fhish.encrypt("euint64", 3_000n, otc.address, addr("bob"));
    const r1 = await send("bob", otc.address, otc.abi, "take", [0n, low.handle, low.proof]);
    const high = await fhish.encrypt("euint64", 3_200n, otc.address, addr("carol"));
    const r2 = await send("carol", otc.address, otc.abi, "take", [0n, high.handle, high.proof]);
    const reqAbi = parseAbi(["event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)"]);
    for (const rc of [r1, r2]) await waitForDecryption(pub as never, dep.oracle, parseEventLogs({ abi: reqAbi, logs: rc.logs })[0]!.args.requestId);
    const take2 = (await pub.readContract({ address: otc.address, abi: otc.abi, functionName: "takes", args: [parseEventLogs({ abi: reqAbi, logs: r2.logs })[0]!.args.requestId] })) as any[];
    const take1 = (await pub.readContract({ address: otc.address, abi: otc.abi, functionName: "takes", args: [parseEventLogs({ abi: reqAbi, logs: r1.logs })[0]!.args.requestId] })) as any[];
    results.push({ name: "Dark OTC", pass: take1[3] === false && take1[4] === 0n && take2[3] === true && take2[4] === 3150n, detail: `bob @3000 missed (nothing revealed), carol @3200 crossed at the maker's 3150` });
  } catch (e) {
    results.push({ name: "Dark OTC", pass: false, detail: (e as Error).message });
  }

  if (viaCre) {
    const ful = await pub.getLogs({ address: dep.oracle, event: parseAbi(["event DecryptionFulfilled(uint256 indexed requestId, uint256[] cleartexts, bool callbackOk, address via)"])[0], fromBlock: BigInt(dep.deployBlock) });
    const viaFwd = ful.filter((l) => l.args.via?.toLowerCase() === CRE_FORWARDER.toLowerCase()).length;
    results.push({ name: "Chainlink CRE delivery", pass: ful.length > 0 && viaFwd === ful.length, detail: `${viaFwd}/${ful.length} callbacks delivered by CRE reports through the KeystoneForwarder (KMS signatures re-verified on-chain)` });
  }

  if (keep) {
    say("5 · deploying long-lived demo apps for the playground");
    const auction = await deployApp("Examples.sol", "FhishAuction", ["Genesis hanko #2", 3600n], "alice");
    const cusdc = await deployApp("Examples.sol", "ConfidentialWrappedToken", [USDC, "Confidential USDC", "cUSDC"], "alice");
    const otc = await deployApp("Examples.sol", "FhishDarkOTC", [], "alice");
    for (const k of Object.values(KEYS)) await rpc("anvil_dealERC20", [privateKeyToAccount(k).address, USDC, "0x" + (1_000_000_000n).toString(16)]);
    const apps = { auction: auction.address, cusdc: cusdc.address, otc: otc.address, usdc: USDC };
    (await import("node:fs")).writeFileSync(`${ROOT}contracts/deployments/local-apps.json`, JSON.stringify(apps, null, 2));
    console.log("  playground apps:", JSON.stringify(apps));
  }
  const m = (await fhish.metrics()) as any;
  say(`Fhish on Monad e2e (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const r of results) console.log(`${r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.name.padEnd(32)} ${r.detail}`);
  console.log("\nlatency (ms, real tfhe-rs on this machine):", JSON.stringify(m.latencyMs));
  console.log("counts:", JSON.stringify(m.counts));
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: "setup", pass: false, detail: (e as Error).message });
  })
  .finally(() => {
    if (!keep) for (const p of procs) p.kill("SIGTERM");
    process.exit(results.length > 0 && results.every((r) => r.pass) ? 0 : 1);
  });
