// Kakushi testnet deploy: one orchestrated, idempotent, resumable run over every chain.
//
//   node scripts/deploy-testnet.ts [--dry-run]            simulate everything (default; sends nothing public)
//   node scripts/deploy-testnet.ts --broadcast            REAL: Monad testnet, Sepolia, Base Sepolia
//   node scripts/deploy-testnet.ts --broadcast --rpc-overrides monadTestnet=http://127.0.0.1:18910,sepolia=…,baseSepolia=…
//
// Options: --chains monadTestnet,sepolia (subset; default all) · --extra-spokes (Arbitrum + OP Sepolia; no
// funding planned) · --skip-fhe · --skip-makers · --mon-pool 0.1 · --eth-pool 0.001 · --usdc-pool 1 ·
// --maker1-max-usdc 1 · --maker1-margin-usdc 1.5 · --maker2-max-eth 0.002 · --monad-gas-multiplier 115 ·
// --gas-multiplier 130 · --max-mon 10 (abort above this Monad deployer estimate) · --yes (skip the 10 s countdown before a public broadcast)
//
// Keys: DEPLOYER_PK, MAKER_KEY_1, MAKER_KEY_2 (RELAYER_KEY, WATCHTOWER_KEY: addresses only) from the
// environment, else read from ./.env.testnet (gitignored). They are never printed; forge receives
// DEPLOYER_PK through its environment, never on a command line.
//
// Per chain, in order (each step checks the chain first and is skipped when already done, so a re-run
// resumes where a failed or underfunded run stopped):
//   1. ZK core     packages/contracts script/Deploy.s.sol (hub on Monad, spoke elsewhere)
//   2. privacy     script/DeployPrivacy.s.sol with KAKUSHI_SKIP_CURATED_POOLS=true (stealth + factory)
//   3. pools       KakushiPoolFactory.createPool: native + USDC, small denominations (flags above)
//   4. FHE         (Monad) fhe/contracts script/Deploy.s.sol (registry via CreateX CREATE3, 2-of-3 input and
//                  KMS signers from fhe/.secrets/signers.testnet.json, created if missing), then
//                  KakushiPayToken over Circle USDC (and AUSD if it has code) and ConfidentialStealthPay
//   5. makers      maker1: USDC Sepolia<->Monad (max 1 USDC, margin 1.5 USDC); maker2: ETH Sepolia<->Base
//                  only if its Monad USDC covers the priced margin; PayoutRouter approvals per chain
// then writes config/generated/{deployments,makers,relayer,operators,fhe}.testnet.json.
//
// Gas: explicit price = live eth_gasPrice x 1.1 (tip = live eth_maxPriorityFeePerGas, capped), taken from
// the chain's public RPC, instead of forge's 2x base-fee default. Every step is estimated first (forge:
// a simulation run; viem: eth_estimateGas) and the step aborts its chain if the signer's balance is below
// the estimate. Monad charges the gas LIMIT, so Monad costs are limit x price; OP-stack chains add the
// L1 data fee (GasPriceOracle.getL1Fee).
//
// Monad reserve rule: a tx sending MON *value* reverts if it leaves the sender below min(10 MON, its
// balance) unless it is an undelegated EOA's "emptying" tx (once per 3 blocks). Nothing here sends MON
// value (deploys, createPool, margin in USDC, approvals): the script refuses a Monad tx with value.
//
// --dry-run: one throwaway anvil fork at a time (port 18913) of each chain's public archive RPC, balances
// topped up on the fork only, the full sequence run against it, costs priced at the live gas price and
// compared with the live balances and the planned funding. Outputs go to .stack/testnet-dryrun/ and
// packages/contracts/deployments/.dryrun/ (both gitignored, wiped per run); nothing touches a public
// network. --rpc-overrides with loopback URLs is a fork rehearsal of the broadcast path: outputs go to
// .stack/testnet-rehearsal/ and deployments/.rehearsal/. Only --broadcast without loopback overrides
// writes the real records (packages/contracts/deployments/testnet/, fhe/contracts/deployments/testnet*.json,
// config/generated/*.testnet.json).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Abi,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAINS, CRE_FORWARDERS, ETH_USD_FEED_MONAD_TESTNET, PROTOCOL, rpcUrl, type ChainKey } from "@kakushi/config";
import { loadDeployments, type HubDeployment, type PrivacyPoolDeployment, type SpokeDeployment } from "@kakushi/config/deployments";
import { ebcAbi } from "@kakushi/sdk";
import { viemChain } from "@kakushi/sdk";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTRACTS = `${ROOT}packages/contracts`;
const FHE_CONTRACTS = `${ROOT}fhe/contracts`;

// ------------------------------------------------------------------ fixed testnet configuration

const EXPECTED = {
  deployer: "0x2c76aA36C88E89734223A5Cf0c54697782B9C24C",
  maker1: "0xa99c2cA996baBE6b74030302AfeD456cad4DBb5B",
  maker2: "0xF98FE16d90B079AF9e99219a00B42c3279d0D819",
  relayer: "0x62BDAe5619f3a144A947dAFB33ee7a1d23156613",
  watchtower: "0xef8ba36C31bafe18aAA1b38788740e852448aF93",
} as const;
const CRE_WORKFLOW_OWNER = "0x4d9e1a826a6DBE986EF8997E57464A2a3443DAb2";
const CRE_FORWARDER = CRE_FORWARDERS.simulation; // MockKeystoneForwarder (exists on Monad testnet)
const CLEANVERSE_CVA = "0xfA96De5B8F434c26FdFf953303dD66fF80af1026";
const CLEANVERSE_VALIDATOR = "0xaC7e5179C2C7f03f209136886c172eb34F161792";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Hex;
const OP_GAS_ORACLE = "0x420000000000000000000000000000000000000F" as Hex;
/** planned funding (2026-10-12) for the report: native per chain, then USDC */
const FUNDING: Record<string, Record<string, string>> = {
  monadTestnet: { deployer: "12", relayer: "3", maker1: "2", maker2: "2", watchtower: "1.5", "maker1 USDC": "5", "maker2 USDC": "3" },
  sepolia: { deployer: "0.05", maker1: "0.05", "maker1 USDC": "5" },
  baseSepolia: { deployer: "0.05", maker1: "0.05" },
  arbitrumSepolia: {},
  opSepolia: {},
};
/** archive RPCs the dry run forks (override: <PREFIX>_FORK_URL) */
const FORK_SOURCES: Record<ChainKey, string> = {
  monadTestnet: "https://rpc-testnet.monadinfra.com",
  sepolia: "https://sepolia.gateway.tenderly.co",
  baseSepolia: "https://sepolia.base.org",
  arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
  opSepolia: "https://sepolia.optimism.io",
};
const DRY_RUN_PORT = 18913;

// ------------------------------------------------------------------ arguments

type Role = keyof typeof EXPECTED;
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : dflt;
};
if (flag("dry-run") && flag("broadcast")) throw new Error("--dry-run and --broadcast are exclusive");
const BROADCAST = flag("broadcast");
const OVERRIDES: Partial<Record<ChainKey, string>> = {};
for (const pair of opt("rpc-overrides", "").split(",").filter(Boolean)) {
  const [k, url] = pair.split("=");
  if (!k || !url || !(k in CHAINS)) throw new Error(`bad --rpc-overrides entry ${pair} (use chainKey=url)`);
  OVERRIDES[k as ChainKey] = url;
}
const isLoopback = (url: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
const overrideList = Object.values(OVERRIDES);
if (overrideList.length && overrideList.some(isLoopback) && !overrideList.every(isLoopback)) throw new Error("--rpc-overrides mixes loopback and public URLs");
const REHEARSAL = BROADCAST && overrideList.length > 0 && overrideList.every(isLoopback);
const REAL = BROADCAST && !REHEARSAL;
const MODE = !BROADCAST ? "dryrun" : REHEARSAL ? "rehearsal" : "testnet";
const ALL_CHAINS: ChainKey[] = ["monadTestnet", "sepolia", "baseSepolia", ...(flag("extra-spokes") ? (["arbitrumSepolia", "opSepolia"] as ChainKey[]) : [])];
const CHAIN_FILTER = opt("chains", "").split(",").filter(Boolean) as ChainKey[];
for (const k of CHAIN_FILTER) if (!ALL_CHAINS.includes(k)) throw new Error(`--chains: ${k} is not deployed by this run (add --extra-spokes for arbitrumSepolia/opSepolia)`);
const RUN_CHAINS = CHAIN_FILTER.length ? ALL_CHAINS.filter((k) => CHAIN_FILTER.includes(k)) : ALL_CHAINS;
if (REHEARSAL) for (const k of RUN_CHAINS) if (!OVERRIDES[k]) throw new Error(`fork rehearsal: no --rpc-overrides entry for ${k}`);
const SKIP_FHE = flag("skip-fhe");
const SKIP_MAKERS = flag("skip-makers");
const POOLS = { mon: opt("mon-pool", "0.1"), eth: opt("eth-pool", "0.001"), usdc: opt("usdc-pool", "1") };
const MAKER1 = { maxUsdc: opt("maker1-max-usdc", "1"), marginUsdc: opt("maker1-margin-usdc", "1.5") };
const MAKER2 = { maxEth: opt("maker2-max-eth", "0.002") };
/** abort when the (dry-run) Monad deployer estimate exceeds this many MON */
const MAX_MON = opt("max-mon", "");
const GAS_MULT = { monad: Number(opt("monad-gas-multiplier", "115")), other: Number(opt("gas-multiplier", "130")) };

// where this mode writes (real records only on a real broadcast)
const RECORDS_REL = REAL ? "deployments" : `deployments/.${MODE}`;
const RECORDS_DIR = `${CONTRACTS}/${RECORDS_REL}`;
const FHE_NET = REAL ? "testnet" : `testnet-${MODE}`;
const OUT_DIR = REAL ? `${ROOT}config/generated` : `${ROOT}.stack/testnet-${MODE}`;
const FORGE_BROADCAST_DIR = REAL ? undefined : `${ROOT}.stack/testnet-${MODE}/forge-broadcast`;
const LOG_DIR = `${ROOT}.stack/testnet-${MODE}`;

// ------------------------------------------------------------------ keys (never printed)

function loadKeys(): Record<"deployer" | "maker1" | "maker2", PrivateKeyAccount> & { deployerPk: Hex } {
  const file: Record<string, string> = {};
  const p = `${ROOT}.env.testnet`;
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) file[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  const get = (name: string) => {
    const v = process.env[name] || file[name];
    if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} missing or malformed (environment or .env.testnet)`);
    return v as Hex;
  };
  const deployerPk = get("DEPLOYER_PK");
  const out = { deployer: privateKeyToAccount(deployerPk), maker1: privateKeyToAccount(get("MAKER_KEY_1")), maker2: privateKeyToAccount(get("MAKER_KEY_2")), deployerPk };
  for (const r of ["deployer", "maker1", "maker2"] as const) {
    if (out[r].address !== EXPECTED[r]) throw new Error(`${r} key derives ${out[r].address}, expected ${EXPECTED[r]}`);
  }
  return out;
}
const KEYS = loadKeys();

// ------------------------------------------------------------------ small helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (m: string) => console.log(m);
const fmt = (wei: bigint, dec = 18, digits = 6) => {
  const s = formatUnits(wei, dec);
  const [i, f = ""] = s.split(".");
  return f ? `${i}.${f.slice(0, digits).replace(/0+$/, "") || "0"}` : i!;
};
const readJson = <T = any>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
const writeJson = (p: string, v: unknown) => {
  mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  writeFileSync(p, `${JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`);
};
const recordPath = (k: ChainKey) => `${RECORDS_DIR}/testnet/${CHAINS[k].chainId}.json`;

class Shortfall extends Error {
  constructor(chain: ChainKey, role: Role, step: string, need: bigint, have: bigint) {
    super(`${CHAINS[chain].shortName}: ${role} ${EXPECTED[role]} has ${fmt(have)} ${CHAINS[chain].nativeSymbol}, step "${step}" needs ~${fmt(need)}: fund it and re-run (completed steps are skipped)`);
  }
}

// ------------------------------------------------------------------ per-chain context

interface Ctx {
  key: ChainKey;
  url: string;
  chain: Chain;
  pub: PublicClient;
  live: PublicClient;
  price: bigint;
  tip: bigint;
  mult: number;
  monad: boolean;
  opStack: boolean;
}

interface Entry {
  chain: ChainKey;
  step: string;
  role: Role;
  txs: number;
  gas: bigint;
  l1Fee: bigint;
  cost: bigint;
  status: "sent" | "skipped" | "estimated";
  note?: string;
}
const ledger: Entry[] = [];
const notes: string[] = [];

function assertTarget(c: Ctx) {
  if (!BROADCAST && !isLoopback(c.url)) throw new Error(`refusing to send to ${c.url} in a dry run`);
  if (REHEARSAL && !isLoopback(c.url)) throw new Error(`refusing to send to ${c.url} in a fork rehearsal`);
}

async function makeCtx(k: ChainKey, url: string): Promise<Ctx> {
  const c = CHAINS[k];
  const chain = viemChain(c, "testnet", url);
  const pub = createPublicClient({ chain, transport: http(url, { retryCount: 4, retryDelay: 400, timeout: 60_000 }) }) as PublicClient;
  const live = createPublicClient({ chain: viemChain(c, "testnet", c.publicRpc), transport: http(c.publicRpc, { retryCount: 4, retryDelay: 400 }) }) as PublicClient;
  const id = await pub.getChainId();
  if (id !== c.chainId) throw new Error(`${url} serves chain ${id}, not ${c.name}`);
  // the live network's price, not the fork's (a fork's base fee drifts down on empty blocks)
  const src = await live.getChainId().then(() => live).catch(() => pub);
  const gp = await src.getGasPrice();
  const price = (gp * 11n) / 10n;
  const rawTip = await src.request({ method: "eth_maxPriorityFeePerGas" } as never).then((x) => BigInt(x as string)).catch(() => gp / 10n);
  const tip = rawTip > price ? price : rawTip;
  const monad = k === "monadTestnet";
  return { key: k, url, chain, pub, live, price, tip, mult: monad ? GAS_MULT.monad : GAS_MULT.other, monad, opStack: k === "baseSepolia" || k === "opSepolia" };
}

async function l1Fee(c: Ctx, data: Hex): Promise<bigint> {
  if (!c.opStack) return 0n;
  try {
    return (await c.live.readContract({ address: OP_GAS_ORACLE, abi: parseAbi(["function getL1Fee(bytes) view returns (uint256)"]), functionName: "getL1Fee", args: [data] })) as bigint;
  } catch {
    return 0n;
  }
}

const accountOf = (r: Role) => (r === "deployer" ? KEYS.deployer : r === "maker1" ? KEYS.maker1 : r === "maker2" ? KEYS.maker2 : null);

/** One viem transaction (value is always 0): estimate, balance check, send, wait, record. */
async function send(c: Ctx, step: string, role: Role, to: Hex | null, data: Hex): Promise<TransactionReceipt> {
  assertTarget(c);
  const acct = accountOf(role);
  if (!acct) throw new Error(`no key for ${role}`);
  const est = await c.pub.estimateGas({ account: acct.address, ...(to ? { to } : {}), data, value: 0n });
  const gas = (est * BigInt(c.mult)) / 100n;
  const fee = await l1Fee(c, data);
  const need = gas * c.price + fee;
  const bal = await c.pub.getBalance({ address: acct.address });
  if (bal < need) throw new Shortfall(c.key, role, step, need, bal);
  const w = createWalletClient({ account: acct, chain: c.chain, transport: http(c.url) });
  const hash = await w.sendTransaction({ account: acct, chain: c.chain, ...(to ? { to } : {}), data, value: 0n, gas, maxFeePerGas: c.price, maxPriorityFeePerGas: c.tip });
  const rc = await c.pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (rc.status !== "success") throw new Error(`${step}: transaction reverted ${hash}`);
  const charged = c.monad ? gas : rc.gasUsed;
  ledger.push({ chain: c.key, step, role, txs: 1, gas: charged, l1Fee: fee, cost: charged * c.price + fee, status: "sent" });
  say(`    ${step}: ${hash} (${charged} gas${c.monad ? " limit" : ""})`);
  return rc;
}

function skip(c: Ctx, step: string, role: Role, note: string) {
  ledger.push({ chain: c.key, step, role, txs: 0, gas: 0n, l1Fee: 0n, cost: 0n, status: "skipped", note });
  say(`  ${step}: ${note}`);
}

// ------------------------------------------------------------------ forge

interface ForgeTx {
  hash?: string;
  transaction: { gas?: string; value?: string; input?: string; data?: string; to?: string | null };
}

/** Run a forge script: a simulation first (estimate + balance check + no-value check on Monad), then the
 *  broadcast. The simulation writes into scratch folders that are removed right after. */
function forgeRun(
  c: Ctx,
  step: string,
  project: string,
  script: string,
  env: Record<string, string>,
  scratch: { prepare: () => Record<string, string>; cleanup: () => void },
): Promise<void> {
  return (async () => {
    assertTarget(c);
    const base = script.split("/").pop()!;
    const bdir = FORGE_BROADCAST_DIR ? `${FORGE_BROADCAST_DIR}/${project === CONTRACTS ? "zk" : "fhe"}` : `${project}/broadcast`;
    const id = CHAINS[c.key].chainId;
    const common = ["script", script, "--rpc-url", c.url, "--sender", EXPECTED.deployer, "--with-gas-price", c.price.toString(), "--priority-gas-price", c.tip.toString(), "--gas-estimate-multiplier", String(c.mult)];
    const baseEnv: Record<string, string> = { ...(process.env as Record<string, string>), ...env, DEPLOYER_PK: KEYS.deployerPk, ...(FORGE_BROADCAST_DIR ? { FOUNDRY_BROADCAST: bdir } : {}) };
    delete baseEnv.MAKER_KEY_1;
    delete baseEnv.MAKER_KEY_2;
    delete baseEnv.RELAYER_KEY;
    delete baseEnv.WATCHTOWER_KEY;
    delete baseEnv.CRE_ETH_PRIVATE_KEY;
    const logFile = `${LOG_DIR}/forge-${c.key}-${step.replace(/[^a-z0-9]+/gi, "-")}.log`;
    mkdirSync(LOG_DIR, { recursive: true });
    const exec = (args: string[], extraEnv: Record<string, string>) => {
      try {
        const out = execFileSync("forge", args, { cwd: project, env: { ...baseEnv, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
        writeFileSync(logFile, out);
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer };
        const text = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`;
        writeFileSync(logFile, text);
        throw new Error(`${step}: forge failed (log ${logFile.replace(ROOT, "")}):\n${text.split("\n").filter((l) => /error|revert|fail/i.test(l)).slice(-8).join("\n")}`);
      }
    };
    const dropDryRun = () => {
      rmSync(`${bdir}/${base}/${id}/dry-run`, { recursive: true, force: true });
      rmSync(`${project}/cache/${base}/${id}/dry-run`, { recursive: true, force: true });
    };
    // forge keeps "sensitive" run data (RPC URLs) in cache/<script>/<chainId>/ regardless of
    // FOUNDRY_BROADCAST; outside a real broadcast remove exactly the files this step adds there
    const cacheDir = `${project}/cache/${base}/${id}`;
    const listCache = () => (existsSync(cacheDir) ? new Set(readdirSync(cacheDir)) : new Set<string>());
    const cacheBefore = listCache();
    const dropNewCache = () => {
      for (const f of listCache()) if (!cacheBefore.has(f)) rmSync(`${cacheDir}/${f}`, { recursive: true, force: true });
    };

    // 1. simulation (no --broadcast): estimate
    const simEnv = scratch.prepare();
    try {
      exec(common, simEnv);
    } finally {
      scratch.cleanup();
    }
    const sim = readJson<{ transactions: ForgeTx[] }>(`${bdir}/${base}/${id}/dry-run/run-latest.json`);
    dropDryRun();
    if (!sim) throw new Error(`${step}: forge simulation wrote no transactions file`);
    let gas = 0n;
    let fee = 0n;
    for (const t of sim.transactions) {
      if (c.monad && BigInt(t.transaction.value ?? "0") !== 0n) throw new Error(`${step}: a Monad transaction carries MON value (reserve rule): refusing`);
      gas += BigInt(t.transaction.gas ?? "0");
      fee += await l1Fee(c, (t.transaction.input ?? t.transaction.data ?? "0x") as Hex);
    }
    const need = gas * c.price + fee;
    const bal = await c.pub.getBalance({ address: EXPECTED.deployer });
    if (bal < need) throw new Shortfall(c.key, "deployer", step, need, bal);

    // 2. broadcast
    exec([...common, "--broadcast", "--slow"], {});
    dropDryRun();
    if (!REAL) dropNewCache();
    const run = readJson<{ transactions: ForgeTx[]; receipts: { gasUsed: string; status: string }[] }>(`${bdir}/${base}/${id}/run-latest.json`);
    if (!run) throw new Error(`${step}: forge broadcast wrote no receipts`);
    let charged = 0n;
    run.transactions.forEach((t, i) => {
      charged += c.monad ? BigInt(t.transaction.gas ?? "0") : BigInt(run.receipts[i]?.gasUsed ?? "0");
    });
    if (run.receipts.some((r) => BigInt(r.status) !== 1n)) throw new Error(`${step}: a transaction reverted (see ${bdir}/${base}/${id}/run-latest.json)`);
    ledger.push({ chain: c.key, step, role: "deployer", txs: run.transactions.length, gas: charged, l1Fee: fee, cost: charged * c.price + fee, status: "sent" });
    say(`  ${step}: ${run.transactions.length} txs, ${charged} gas${c.monad ? " (limits)" : ""}, ~${fmt(charged * c.price + fee)} ${CHAINS[c.key].nativeSymbol}`);
  })();
}

const hasCode = async (c: Ctx, a?: string | null) => Boolean(a && /^0x[0-9a-fA-F]{40}$/.test(a) && ((await c.pub.getCode({ address: a as Hex })) ?? "0x") !== "0x");

// ------------------------------------------------------------------ steps: ZK core + privacy + pools

type Rec = SpokeDeployment & Partial<HubDeployment> & { privacy?: any };

async function zkCore(c: Ctx) {
  const step = c.monad ? "zk hub (Deploy.s.sol)" : "zk spoke (Deploy.s.sol)";
  const rec = readJson<Rec>(recordPath(c.key));
  const addrs = rec ? [rec.payoutRouter, rec.sourceRouter, ...(c.monad ? [rec.ebc, rec.mdc, rec.disputeModule, rec.attestationOracle] : [])] : [];
  if (rec && rec.deployer === EXPECTED.deployer && (await Promise.all(addrs.map((a) => hasCode(c, a)))).every(Boolean)) return skip(c, step, "deployer", `done (${c.monad ? `DisputeModule ${rec.disputeModule}` : `PayoutRouter ${rec.payoutRouter}`})`);
  const keepPrivacy = rec?.privacy; // Deploy.s.sol rewrites the record; DeployPrivacy re-merges, reusing the verifier
  await forgeRun(
    c,
    step,
    CONTRACTS,
    "script/Deploy.s.sol",
    {
      KAKUSHI_ROLE: c.monad ? "hub" : "spoke",
      KAKUSHI_NETWORK: "testnet",
      KAKUSHI_FILL_WINDOW: String(PROTOCOL.fillWindow),
      KAKUSHI_DISPUTE_WINDOW: String(PROTOCOL.disputeWindow),
      KAKUSHI_CLOCK_SKEW: String(PROTOCOL.clockSkew),
      KAKUSHI_PARAM_DELAY: String(PROTOCOL.paramDelay),
      KAKUSHI_DEPLOYMENTS_DIR: RECORDS_REL,
      ...(c.monad ? { CRE_FORWARDER, CRE_WORKFLOW_OWNER, CLEANVERSE_CVA, CLEANVERSE_VALIDATOR } : {}),
    },
    zkScratch(c),
  );
  if (keepPrivacy) {
    const r = readJson<Rec>(recordPath(c.key))!;
    writeJson(recordPath(c.key), { ...r, privacy: keepPrivacy });
  }
}

/** The forge simulation writes its record into deployments/.preflight (a copy of the current one), never the real record. */
function zkScratch(c: Ctx) {
  const dir = `${CONTRACTS}/deployments/.preflight`;
  return {
    prepare: () => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(`${dir}/testnet`, { recursive: true });
      if (existsSync(recordPath(c.key))) copyFileSync(recordPath(c.key), `${dir}/testnet/${CHAINS[c.key].chainId}.json`);
      return { KAKUSHI_DEPLOYMENTS_DIR: "deployments/.preflight" };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function privacy(c: Ctx) {
  const step = "privacy (DeployPrivacy.s.sol, no curated pools)";
  const rec = readJson<Rec>(recordPath(c.key));
  if (!rec) throw new Error(`${step}: no ZK record for ${c.key}`);
  const p = rec.privacy;
  if (p && (await hasCode(c, p.poolFactory)) && (await hasCode(c, p.stealthPay))) return skip(c, step, "deployer", `done (factory ${p.poolFactory})`);
  const verifier = p?.shieldedVerifier && (await hasCode(c, p.shieldedVerifier)) ? p.shieldedVerifier : "";
  await forgeRun(
    c,
    step,
    CONTRACTS,
    "script/DeployPrivacy.s.sol",
    { KAKUSHI_NETWORK: "testnet", KAKUSHI_DEPLOYMENTS_DIR: RECORDS_REL, KAKUSHI_SKIP_CURATED_POOLS: "true", ...(verifier ? { SHIELDED_VERIFIER: verifier } : {}) },
    zkScratch(c),
  );
}

const factoryAbi = parseAbi(["function createPool(address token, uint256 denomination) returns (address pool)", "function poolOf(address token, uint256 denomination) view returns (address)"]);

async function pools(c: Ctx) {
  const rec = readJson<Rec>(recordPath(c.key))!;
  const factory = rec.privacy?.poolFactory as Hex | undefined;
  if (!factory || !(await hasCode(c, factory))) throw new Error(`pools: no KakushiPoolFactory on ${c.key}`);
  const cfg = CHAINS[c.key];
  const nativeAmt = c.monad ? POOLS.mon : POOLS.eth;
  const specs: (PrivacyPoolDeployment & { label: string })[] = [
    { label: `${cfg.nativeSymbol}-${nativeAmt}`, address: zeroAddress, token: zeroAddress, symbol: cfg.nativeSymbol, decimals: 18, denomination: parseUnits(nativeAmt, 18).toString() },
    { label: `USDC-${POOLS.usdc}`, address: zeroAddress, token: cfg.usdc.address, symbol: "USDC", decimals: cfg.usdc.decimals, denomination: parseUnits(POOLS.usdc, cfg.usdc.decimals).toString() },
  ];
  const out: Record<string, PrivacyPoolDeployment> = { ...(rec.privacy.pools ?? {}) };
  for (const s of specs) {
    const step = `pool ${s.label} (factory.createPool)`;
    if (s.token !== zeroAddress && !(await hasCode(c, s.token))) {
      skip(c, step, "deployer", `skipped: ${s.token} has no code`);
      continue;
    }
    let pool = (await c.pub.readContract({ address: factory, abi: factoryAbi, functionName: "poolOf", args: [s.token, BigInt(s.denomination)] })) as Hex;
    if (pool !== zeroAddress) skip(c, step, "deployer", `done (${pool})`);
    else {
      await send(c, step, "deployer", factory, encodeFunctionData({ abi: factoryAbi, functionName: "createPool", args: [s.token, BigInt(s.denomination)] }));
      pool = (await c.pub.readContract({ address: factory, abi: factoryAbi, functionName: "poolOf", args: [s.token, BigInt(s.denomination)] })) as Hex;
    }
    const { label, ...entry } = s;
    out[label] = { ...entry, address: getAddress(pool) };
  }
  const now = readJson<Rec>(recordPath(c.key))!;
  writeJson(recordPath(c.key), { ...now, privacy: { ...now.privacy, pools: out } });
}

// ------------------------------------------------------------------ steps: FHE (Monad)

interface Signers {
  inputSigners: { address: Hex; privateKey: Hex }[];
  kmsSigners: { address: Hex; privateKey: Hex }[];
  relayer: { address: Hex; privateKey: Hex };
}

/** fhe/.secrets/signers.testnet.json: fresh testnet keys (3 input, 3 KMS, FHE relayer), mode 600, gitignored. */
function testnetSigners(): Signers {
  const p = `${ROOT}fhe/.secrets/signers.testnet.json`;
  if (!existsSync(p)) {
    const one = () => {
      const privateKey = generatePrivateKey();
      return { address: privateKeyToAccount(privateKey).address, privateKey };
    };
    mkdirSync(`${ROOT}fhe/.secrets`, { recursive: true, mode: 0o700 });
    writeFileSync(p, JSON.stringify({ inputSigners: [one(), one(), one()], kmsSigners: [one(), one(), one()], relayer: one() }, null, 2), { mode: 0o600 });
    say(`  generated fresh FHE testnet signer keys: fhe/.secrets/signers.testnet.json (mode 600, gitignored)`);
  }
  chmodSync(p, 0o600);
  return JSON.parse(readFileSync(p, "utf8")) as Signers;
}

const registryAbi = parseAbi(["function isSet() view returns (bool)", "function config() view returns ((address acl, address executor, address inputVerifier, address oracle))", "function owner() view returns (address)"]);
const fheArt = (file: string, name: string) => JSON.parse(readFileSync(`${FHE_CONTRACTS}/out/${file}/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };

interface FheOut {
  network: "testnet";
  chainId: number;
  rpc: string;
  deployBlock: number;
  core: { registry: Hex; acl: Hex; executor: Hex; inputVerifier: Hex; oracle: Hex; creForwarder: Hex };
  tokens: { key: string; name: string; symbol: string; address: Hex; underlying: Hex; underlyingSymbol: string; decimals: number }[];
  stealthPay: Hex;
  stealthAnnouncer: Hex;
  gateway: string | null;
  todo?: string;
  inputThreshold: number;
  kmsThreshold: number;
  inputSigners: Hex[];
  kmsSigners: Hex[];
  fheRelayer: Hex;
  deployedAt: string;
}

async function fhe(c: Ctx) {
  const reg = JSON.parse(readFileSync(`${FHE_CONTRACTS}/registry-address.json`, "utf8")) as { deployer: Hex; salt: Hex; registry: Hex };
  if (reg.deployer !== EXPECTED.deployer) throw new Error(`fhe/contracts/registry-address.json is for ${reg.deployer}, not the Kakushi deployer`);
  const s = testnetSigners();
  const coreFile = `${FHE_CONTRACTS}/deployments/${FHE_NET}.json`;
  const step = "fhe core (registry CREATE3, executor, ACL, verifier, oracle)";
  if (await hasCode(c, reg.registry)) {
    const set = (await c.pub.readContract({ address: reg.registry, abi: registryAbi, functionName: "isSet" })) as boolean;
    if (!set) throw new Error(`${step}: registry ${reg.registry} exists but is not configured: finish the broadcast with forge script ... --resume (fhe/contracts)`);
    skip(c, step, "deployer", `done (registry ${reg.registry})`);
  } else {
    const coreScratch = {
      prepare: () => ({ KAKUSHI_FHE_NETWORK: `${FHE_NET}-preflight` }),
      cleanup: () => rmSync(`${FHE_CONTRACTS}/deployments/${FHE_NET}-preflight.json`, { force: true }),
    };
    await forgeRun(
      c,
      step,
      FHE_CONTRACTS,
      "script/Deploy.s.sol",
      {
        DEPLOYER: EXPECTED.deployer,
        INPUT_SIGNERS: s.inputSigners.map((x) => x.address).join(","),
        KMS_SIGNERS: s.kmsSigners.map((x) => x.address).join(","),
        INPUT_THRESHOLD: "2",
        KMS_THRESHOLD: "2",
        CRE_FORWARDER,
        REGISTRY_SALT: reg.salt,
        KAKUSHI_FHE_NETWORK: FHE_NET,
      },
      coreScratch,
    );
    const d = readJson<{ registry: Hex }>(coreFile);
    if (!d || d.registry.toLowerCase() !== reg.registry.toLowerCase()) throw new Error(`${step}: registry not at its CREATE3 address ${reg.registry}`);
  }
  const cfg = (await c.pub.readContract({ address: reg.registry, abi: registryAbi, functionName: "config" })) as { acl: Hex; executor: Hex; inputVerifier: Hex; oracle: Hex };
  const coreRec = readJson<{ deployBlock?: number; creForwarder?: Hex }>(coreFile);
  // the coprocessor reads this (KAKUSHI_FHE_DEPLOYMENT); rewrite from chain so a resumed run has it
  writeJson(coreFile, { registry: reg.registry, ...cfg, creForwarder: coreRec?.creForwarder ?? CRE_FORWARDER, chainId: CHAINS[c.key].chainId, deployBlock: coreRec?.deployBlock ?? Number(await c.pub.getBlockNumber()) });

  // apps
  const hub = readJson<Rec>(recordPath("monadTestnet"))!;
  const announcer = hub.privacy?.stealthAnnouncer as Hex | undefined;
  if (!announcer || !(await hasCode(c, announcer))) throw new Error("fhe apps: the hub StealthAnnouncer is not deployed");
  const outPath = `${OUT_DIR}/fhe.testnet.json`;
  const prev = readJson<FheOut>(outPath);
  const same = prev && prev.core.executor.toLowerCase() === cfg.executor.toLowerCase();
  const usdc = CHAINS.monadTestnet.usdc.address;
  const wanted = [
    { key: "cUSDC", name: "Confidential USDC", symbol: "cUSDC", underlying: usdc, underlyingSymbol: "USDC", decimals: 6 },
    ...((await hasCode(c, AUSD)) ? [{ key: "cAUSD", name: "Confidential AUSD", symbol: "cAUSD", underlying: AUSD, underlyingSymbol: "AUSD", decimals: 6 }] : []),
  ];
  const tokens: FheOut["tokens"] = [];
  for (const t of wanted) {
    const st = `fhe app KakushiPayToken ${t.symbol}`;
    const old = same ? prev!.tokens.find((x) => x.key === t.key) : undefined;
    if (old && (await hasCode(c, old.address))) {
      skip(c, st, "deployer", `done (${old.address})`);
      tokens.push(old);
      continue;
    }
    const a = fheArt("Examples.sol", "KakushiPayToken");
    const rc = await send(c, st, "deployer", null, encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args: [t.underlying, t.name, t.symbol] }));
    tokens.push({ ...t, address: getAddress(rc.contractAddress!) });
  }
  let stealthPay = same && prev!.stealthAnnouncer.toLowerCase() === announcer.toLowerCase() ? prev!.stealthPay : undefined;
  if (stealthPay && (await hasCode(c, stealthPay))) skip(c, "fhe app ConfidentialStealthPay", "deployer", `done (${stealthPay})`);
  else {
    const a = fheArt("ConfidentialStealthPay.sol", "ConfidentialStealthPay");
    const rc = await send(c, "fhe app ConfidentialStealthPay", "deployer", null, encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args: [announcer] }));
    stealthPay = getAddress(rc.contractAddress!);
  }
  const out: FheOut = {
    network: "testnet",
    chainId: CHAINS.monadTestnet.chainId,
    rpc: CHAINS.monadTestnet.publicRpc,
    deployBlock: readJson<{ deployBlock: number }>(coreFile)!.deployBlock,
    core: { registry: reg.registry, ...cfg, creForwarder: CRE_FORWARDER },
    tokens,
    stealthPay: stealthPay!,
    stealthAnnouncer: announcer,
    // a hosted gateway, once recorded, survives re-runs against the same executor
    ...(same && prev!.gateway
      ? { gateway: prev!.gateway }
      : { gateway: null, todo: "TODO: host the FHE engine + coprocessor gateway (fhe/DEPLOY-LATER.md section 2) and set KAKUSHI_FHE_GATEWAY_URL on the app; until then the app shows Kakushi Confidential as not live" }),
    inputThreshold: 2,
    kmsThreshold: 2,
    inputSigners: s.inputSigners.map((x) => x.address),
    kmsSigners: s.kmsSigners.map((x) => x.address),
    fheRelayer: s.relayer.address,
    deployedAt: same ? prev!.deployedAt : new Date().toISOString(),
  };
  writeJson(outPath, out);
  if (REAL) {
    // fhe/app + fhe/mobile read <network>-apps.json next to the core record
    writeJson(`${FHE_CONTRACTS}/deployments/testnet-apps.json`, { usdc, cusdc: tokens.find((t) => t.key === "cUSDC")?.address, ausd: AUSD, causd: tokens.find((t) => t.key === "cAUSD")?.address, stealthPay });
  }
}

// ------------------------------------------------------------------ steps: makers

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const mdcView = parseAbi(["function margin(address,address) view returns (uint256)", "function required(address,address) view returns (uint256)", "function depositMargin(address token, uint256 amount)"]);
const ebcView = parseAbi([
  "function makerPairs(address) view returns (bytes32[])",
  "function pairIdOf(address maker, uint64 srcChainId, address srcToken, uint16 code) pure returns (bytes32)",
  "function refundFeeAt(address maker, uint64 chainId, address token, uint64 t) view returns (uint256)",
  "function setRefundFee(uint64 chainId, address token, uint128 fee)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);
/** PayoutRouter allowance a Maker grants per chain (bounded; raise with the Maker console) */
const ROUTER_ALLOWANCE_USDC = "100";

interface PairSpec {
  src: ChainKey;
  dst: ChainKey;
  native: boolean;
  withholding: bigint;
  bps: number;
  min: bigint;
  max: bigint;
}

async function registerPairs(c: Ctx, role: "maker1" | "maker2", hub: HubDeployment, pairs: PairSpec[]) {
  const acct = accountOf(role)!;
  const usdc = CHAINS.monadTestnet.usdc.address;
  const have = new Set(((await c.pub.readContract({ address: hub.ebc, abi: ebcView, functionName: "makerPairs", args: [acct.address] })) as Hex[]).map((x) => x.toLowerCase()));
  for (const p of pairs) {
    const src = CHAINS[p.src];
    const dst = CHAINS[p.dst];
    const srcToken = p.native ? zeroAddress : src.usdc.address;
    const step = `${role} pair ${src.shortName}->${dst.shortName} ${p.native ? "ETH" : "USDC"} (max ${p.native ? fmt(p.max) : fmt(p.max, 6)})`;
    const id = (await c.pub.readContract({ address: hub.ebc, abi: ebcView, functionName: "pairIdOf", args: [acct.address, BigInt(src.chainId), srcToken, dst.identCode] })) as Hex;
    if (have.has(id.toLowerCase())) {
      skip(c, step, role, "done");
      continue;
    }
    await send(
      c,
      step,
      role,
      hub.ebc,
      encodeFunctionData({
        abi: ebcAbi,
        functionName: "registerPair",
        args: [
          { maker: acct.address, srcChainId: BigInt(src.chainId), srcToken, dstChainId: BigInt(dst.chainId), dstToken: p.native ? zeroAddress : dst.usdc.address, identCode: dst.identCode },
          { effectiveFrom: 0n, withholdingFee: p.withholding, tradingFeeBps: p.bps, minAmount: p.min, maxAmount: p.max },
          { marginToken: usdc, priceFeed: p.native ? ETH_USD_FEED_MONAD_TESTNET : zeroAddress, srcDecimals: p.native ? 18 : 6, set: true },
        ],
      } as never),
    );
  }
}

async function refundFees(c: Ctx, role: "maker1" | "maker2", hub: HubDeployment, fees: [ChainKey, Hex, bigint][]) {
  const acct = accountOf(role)!;
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const [k, token, fee] of fees) {
    const step = `${role} refund fee ${CHAINS[k].shortName} ${token === zeroAddress ? "ETH" : "USDC"}`;
    const cur = await c.pub.readContract({ address: hub.ebc, abi: ebcView, functionName: "refundFeeAt", args: [acct.address, BigInt(CHAINS[k].chainId), token, now] }).catch(() => -1n);
    if (cur === fee) {
      skip(c, step, role, "done");
      continue;
    }
    await send(c, step, role, hub.ebc, encodeFunctionData({ abi: ebcView, functionName: "setRefundFee", args: [BigInt(CHAINS[k].chainId), token, fee] }));
  }
}

async function approve(c: Ctx, role: Role, token: Hex, spender: Hex, amount: bigint, step: string) {
  const owner = accountOf(role)!.address;
  const cur = (await c.pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [owner, spender] })) as bigint;
  if (cur >= amount) return skip(c, step, role, `done (allowance ${fmt(cur, 6)})`);
  await send(c, step, role, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, amount] }));
}

/** deposit up to `target` margin (USDC on Monad); false if the Maker cannot afford it */
async function margin(c: Ctx, role: "maker1" | "maker2", hub: HubDeployment, target: bigint): Promise<boolean> {
  const usdc = CHAINS.monadTestnet.usdc.address;
  const who = accountOf(role)!.address;
  const cur = (await c.pub.readContract({ address: hub.mdc, abi: mdcView, functionName: "margin", args: [who, usdc] })) as bigint;
  const step = `${role} margin ${fmt(target, 6)} USDC`;
  if (cur >= target) {
    skip(c, step, role, `done (${fmt(cur, 6)} USDC posted)`);
    return true;
  }
  const bal = (await c.pub.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [who] })) as bigint;
  if (bal < target - cur) {
    skip(c, step, role, `NOT POSTED: ${who} holds ${fmt(bal, 6)} USDC on Monad, needs ${fmt(target - cur, 6)} more`);
    notes.push(`${role}: margin not posted (${fmt(bal, 6)} of ${fmt(target - cur, 6)} USDC on Monad); fund USDC and re-run`);
    return false;
  }
  await approve(c, role, usdc, hub.mdc, target - cur, `${role} approve MDC`);
  await send(c, step, role, hub.mdc, encodeFunctionData({ abi: mdcView, functionName: "depositMargin", args: [usdc, target - cur] }));
  return true;
}

let maker1Active = false;
let maker2Active = false;

/** maker1: USDC Sepolia <-> Monad; maker2: native ETH Sepolia <-> Base Sepolia if its USDC covers the priced margin */
async function makersHub(c: Ctx) {
  const hub = readJson<HubDeployment>(recordPath("monadTestnet"))!;
  const u = (x: string) => parseUnits(x, 6);
  const e = (x: string) => parseUnits(x, 18);
  const max1 = u(MAKER1.maxUsdc);
  const target1 = u(MAKER1.marginUsdc);
  const req1 = (max1 * BigInt(PROTOCOL.marginFactorBps)) / 10_000n;
  if (target1 < req1) throw new Error(`maker1 margin ${MAKER1.marginUsdc} USDC is below the requirement ${fmt(req1, 6)} USDC`);
  const ok1 = await margin(c, "maker1", hub, target1);
  if (ok1) {
    await registerPairs(c, "maker1", hub, [
      { src: "sepolia", dst: "monadTestnet", native: false, withholding: u("0.02"), bps: 10, min: u("0.1"), max: max1 },
      { src: "monadTestnet", dst: "sepolia", native: false, withholding: u("0.05"), bps: 10, min: u("0.1"), max: max1 },
    ]);
    await refundFees(c, "maker1", hub, [
      ["sepolia", CHAINS.sepolia.usdc.address, u("0.01")],
      ["monadTestnet", CHAINS.monadTestnet.usdc.address, u("0.01")],
    ]);
    await approve(c, "maker1", CHAINS.monadTestnet.usdc.address, hub.payoutRouter, u(ROUTER_ALLOWANCE_USDC), "maker1 approve PayoutRouter (Monad USDC)");
    maker1Active = true;
  } else notes.push("maker1: routes not registered (no margin)");

  // maker2: priced margin = max x ETH/USD x (1 + haircut) x k
  const [, answer] = (await c.pub.readContract({ address: ETH_USD_FEED_MONAD_TESTNET, abi: feedAbi, functionName: "latestRoundData" })) as readonly [bigint, bigint, bigint, bigint, bigint];
  const fdec = Number(await c.pub.readContract({ address: ETH_USD_FEED_MONAD_TESTNET, abi: feedAbi, functionName: "decimals" }));
  const max2 = e(MAKER2.maxEth);
  const valued = (max2 * answer) / 10n ** BigInt(18 + fdec - 6); // USDC base units
  const req2 = (((valued * BigInt(10_000 + PROTOCOL.priceHaircutBps)) / 10_000n) * BigInt(PROTOCOL.marginFactorBps)) / 10_000n;
  const target2 = ((req2 * 105n) / 100n / 10_000n + 1n) * 10_000n; // +5 %, rounded up to 0.01 USDC
  const who2 = EXPECTED.maker2;
  const posted2 = (await c.pub.readContract({ address: hub.mdc, abi: mdcView, functionName: "margin", args: [who2, CHAINS.monadTestnet.usdc.address] })) as bigint;
  const bal2 = (await c.pub.readContract({ address: CHAINS.monadTestnet.usdc.address, abi: erc20, functionName: "balanceOf", args: [who2] })) as bigint;
  const price = Number(answer) / 10 ** fdec;
  if (posted2 + bal2 < target2) {
    const affordable = (Number(formatUnits(posted2 + bal2, 6)) / (price * 1.2 * 1.1 * 1.05)).toFixed(5);
    const msg = `maker2 ETH Sepolia<->Base SKIPPED: max ${MAKER2.maxEth} ETH at $${price.toFixed(0)} needs ${fmt(target2, 6)} USDC margin on Monad; maker2 has ${fmt(posted2 + bal2, 6)} USDC (would cover max ~${affordable} ETH: --maker2-max-eth)`;
    skip(c, "maker2 ETH lane", "maker2", msg);
    notes.push(msg);
    return;
  }
  if (!(await margin(c, "maker2", hub, target2))) return;
  maker2Active = true;
  await registerPairs(c, "maker2", hub, [
    { src: "sepolia", dst: "baseSepolia", native: true, withholding: e("0.00002"), bps: 30, min: e("0.0001"), max: max2 },
    { src: "baseSepolia", dst: "sepolia", native: true, withholding: e("0.00002"), bps: 30, min: e("0.0001"), max: max2 },
  ]);
  await refundFees(c, "maker2", hub, [
    ["sepolia", zeroAddress, e("0.00001")],
    ["baseSepolia", zeroAddress, e("0.00001")],
  ]);
  notes.push(`maker2: ETH lane registered, but maker2 has no planned Sepolia/Base ETH to pay fills with`);
}

async function makersSpoke(c: Ctx) {
  if (c.key !== "sepolia") return;
  const rec = readJson<Rec>(recordPath("sepolia"))!;
  const hub = readJson<HubDeployment>(recordPath("monadTestnet"));
  if (!hub) return skip(c, "maker1 approve PayoutRouter (Sepolia USDC)", "maker1", "hub not deployed yet: re-run after Monad");
  await approve(c, "maker1", CHAINS.sepolia.usdc.address, rec.payoutRouter, parseUnits(ROUTER_ALLOWANCE_USDC, 6), "maker1 approve PayoutRouter (Sepolia USDC)");
}

// ------------------------------------------------------------------ dry-run forks

async function startFork(k: ChainKey): Promise<{ url: string; proc: ChildProcess }> {
  const src = process.env[`${CHAINS[k].envPrefix}_FORK_URL`] ?? FORK_SOURCES[k];
  const url = `http://127.0.0.1:${DRY_RUN_PORT}`;
  const busy = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false);
  if (busy) throw new Error(`port ${DRY_RUN_PORT} is in use: the dry run needs it for its throwaway fork`);
  mkdirSync(LOG_DIR, { recursive: true });
  const proc = spawn("anvil", ["--port", String(DRY_RUN_PORT), "--fork-url", src, "--retries", "12", "--fork-retry-backoff", "750", "--timeout", "60000", "--prune-history", "300", "--silent"], { stdio: "ignore" });
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    const id = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', signal: AbortSignal.timeout(2000) })
      .then((r) => r.json() as Promise<{ result?: string }>)
      .then((j) => (j.result ? Number(j.result) : null))
      .catch(() => null);
    if (id === CHAINS[k].chainId) return { url, proc };
    if (proc.exitCode !== null) break;
    await sleep(500);
  }
  proc.kill("SIGTERM");
  throw new Error(`anvil fork of ${src} did not come up on ${DRY_RUN_PORT}`);
}

/** simulation funding on the throwaway fork only: generous native, the planned USDC */
async function fundFork(c: Ctx) {
  const rpc = (method: string, params: unknown[]) => c.pub.request({ method: method as never, params: params as never });
  for (const r of ["deployer", "maker1", "maker2"] as const) {
    await rpc("anvil_setBalance", [EXPECTED[r], `0x${parseUnits("1000", 18).toString(16)}`]);
  }
  const usdc = CHAINS[c.key].usdc.address;
  const plan = FUNDING[c.key] ?? {};
  for (const r of ["maker1", "maker2"] as const) {
    const amt = plan[`${r} USDC`];
    if (amt) await rpc("anvil_dealERC20", [EXPECTED[r], usdc, `0x${parseUnits(amt, 6).toString(16)}`]);
  }
}

// ------------------------------------------------------------------ outputs

function writeOutputs(liveBalances: Record<string, Record<string, bigint>>) {
  mkdirSync(OUT_DIR, { recursive: true });
  let d: ReturnType<typeof loadDeployments> | null = null;
  try {
    d = loadDeployments("testnet", RECORDS_DIR);
  } catch (e) {
    notes.push(`deployments.testnet.json: ${(e as Error).message.replace(/^.*: /, "")} (written with the chains deployed so far)`);
  }
  if (!d) {
    // hub only so far (spokes not funded yet): the same shape, covering just the chains with a record
    const chains: Record<number, Rec> = {};
    for (const k of ALL_CHAINS) {
      const r = readJson<Rec>(recordPath(k));
      if (r) chains[CHAINS[k].chainId] = r;
    }
    const hubRec = chains[CHAINS.monadTestnet.chainId];
    if (hubRec) writeJson(`${OUT_DIR}/deployments.testnet.json`, { network: "testnet", hub: hubRec, chains });
  }
  if (d) writeJson(`${OUT_DIR}/deployments.testnet.json`, d);

  const hub = readJson<HubDeployment>(recordPath("monadTestnet"));
  const maker2Live = maker2Active;
  // only Makers whose routes are registered (none with --skip-makers)
  const makers = [
    ...(maker1Active ? [{ name: "Maker 1", address: EXPECTED.maker1, url: "https://REPLACE-maker1", todo: "TODO: hosting not decided; set the public HTTPS URL of maker1's node (packages/maker, MAKER_KEY_1)", routes: `USDC Sepolia<->Monad, max ${MAKER1.maxUsdc} USDC` }] : []),
    ...(maker2Live ? [{ name: "Maker 2", address: EXPECTED.maker2, url: "https://REPLACE-maker2", todo: "TODO: hosting not decided; set the public HTTPS URL of maker2's node (packages/maker, MAKER_KEY_2)", routes: `ETH Sepolia<->Base Sepolia, max ${MAKER2.maxEth} ETH` }] : []),
  ];
  writeJson(`${OUT_DIR}/makers.testnet.json`, makers);

  // relayer pools: every factory pool this run opened (RELAYER_CONFIG=config/generated/relayer.testnet.json)
  const relayerPools: { chainId: number; pool: Hex; minFee: string; label: string }[] = [];
  for (const k of ALL_CHAINS) {
    const rec = readJson<Rec>(recordPath(k));
    for (const [label, p] of Object.entries((rec?.privacy?.pools ?? {}) as Record<string, PrivacyPoolDeployment>)) {
      // 10 % of the denomination: a relayed withdrawal (~2.4M gas) costs more than that on Monad and Sepolia
      // at current prices, so these fees are placeholders until the relayer is funded and priced
      relayerPools.push({ chainId: CHAINS[k].chainId, pool: p.address, minFee: (BigInt(p.denomination) / 10n).toString(), label });
    }
  }
  writeJson(`${OUT_DIR}/relayer.testnet.json`, {
    relayer: EXPECTED.relayer,
    note: "RELAYER_KEY from .env.testnet; RELAYER_CONFIG=config/generated/relayer.testnet.json. minFee is a floor: the relayer quotes native pools at the live gas cost (~6.2M gas per UltraHonk withdraw on Monad testnet) and relays token pools only with a maxGasWei cap.",
    pools: relayerPools,
  });

  writeJson(`${OUT_DIR}/operators.testnet.json`, {
    note: "Public addresses only. Keys: .env.testnet (gitignored).",
    deployer: EXPECTED.deployer,
    creWorkflowOwner: CRE_WORKFLOW_OWNER,
    creForwarder: CRE_FORWARDER,
    relayer: { address: EXPECTED.relayer, env: "RELAYER_KEY", config: "config/generated/relayer.testnet.json" },
    watchtower: {
      address: EXPECTED.watchtower,
      env: "WATCHTOWER_KEY",
      disputeBondWei: (hub?.bond ?? PROTOCOL.disputeBondWei).toString(),
      fundedMon: FUNDING.monadTestnet!.watchtower,
      reserveRule: "each bond is MON value: the watchtower serializes its txs and spaces bonds >= 3 blocks / 1.2 s (WATCHTOWER_VALUE_SPACING_BLOCKS, default 3 on testnet) so every bond can use Monad's emptying exception",
    },
    makers: [
      { name: "Maker 1", address: EXPECTED.maker1, env: "MAKER_KEY_1" },
      { name: "Maker 2", address: EXPECTED.maker2, env: "MAKER_KEY_2", active: maker2Live },
    ],
    fhe: existsSync(`${OUT_DIR}/fhe.testnet.json`) ? { registry: readJson<FheOut>(`${OUT_DIR}/fhe.testnet.json`)!.core.registry, relayer: readJson<FheOut>(`${OUT_DIR}/fhe.testnet.json`)!.fheRelayer, secrets: "fhe/.secrets/signers.testnet.json" } : null,
    liveBalancesAtDeploy: Object.fromEntries(Object.entries(liveBalances).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([r, b]) => [r, fmt(b)]))])),
  });
}

function report(liveBalances: Record<string, Record<string, bigint>>, prices: Record<string, { price: bigint; tip: bigint }>, failed: Record<string, string>) {
  say(`\n=== ${MODE === "dryrun" ? "DRY RUN (simulated on throwaway forks; nothing sent to a public network)" : MODE === "rehearsal" ? "FORK REHEARSAL (broadcast path against loopback forks)" : "TESTNET BROADCAST"} ===`);
  const rows: Record<string, unknown>[] = [];
  for (const k of RUN_CHAINS) {
    const sym = CHAINS[k].nativeSymbol;
    const p = prices[k];
    say(`\n${CHAINS[k].name}${p ? `  gas price ${fmt(p.price, 9, 3)} gwei (live x1.1), tip ${fmt(p.tip, 9, 3)} gwei${k === "monadTestnet" ? ", charged on gas LIMIT" : ""}` : ""}${failed[k] ? `\n  ABORTED: ${failed[k]}` : ""}`);
    for (const e of ledger.filter((x) => x.chain === k)) {
      if (e.status === "skipped") continue;
      say(`  ${e.step.padEnd(58)} ${e.role.padEnd(8)} ${String(e.txs).padStart(3)} tx ${e.gas.toString().padStart(10)} gas ${fmt(e.cost).padStart(12)} ${sym}${e.l1Fee ? ` (L1 ${fmt(e.l1Fee)})` : ""}`);
    }
    const roles = [...new Set(ledger.filter((x) => x.chain === k).map((x) => x.role))];
    for (const r of roles) {
      const total = ledger.filter((x) => x.chain === k && x.role === r).reduce((s, x) => s + x.cost, 0n);
      const plan = FUNDING[k]?.[r];
      const live = liveBalances[k]?.[r];
      say(`  TOTAL ${r.padEnd(10)} ~${fmt(total)} ${sym}   planned funding ${plan ?? "none"} ${sym}   live balance ${live !== undefined ? fmt(live) : "?"} ${sym}${plan ? (parseUnits(plan, 18) >= total ? "   OK" : "   SHORT") : ""}`);
      rows.push({ chain: k, role: r, estimate: fmt(total), planned: plan ?? null, live: live !== undefined ? fmt(live) : null });
    }
  }
  if (notes.length) say(`\nNotes:\n${notes.map((n) => `  - ${n}`).join("\n")}`);
  writeJson(`${LOG_DIR}/report.json`, { mode: MODE, at: new Date().toISOString(), prices, totals: rows, ledger, notes, failed });
  say(`\nreport: ${LOG_DIR.replace(ROOT, "")}/report.json`);
}

// ------------------------------------------------------------------ main

async function main() {
  say(`Kakushi testnet deploy: ${MODE === "dryrun" ? "DRY RUN" : MODE === "rehearsal" ? "fork rehearsal (--broadcast to loopback forks)" : "BROADCAST TO PUBLIC TESTNETS"}`);
  say(`  chains: ${RUN_CHAINS.map((k) => CHAINS[k].shortName).join(", ")}  ·  deployer ${EXPECTED.deployer}  ·  records ${RECORDS_REL}/testnet  ·  outputs ${OUT_DIR.replace(ROOT, "")}`);
  if (!BROADCAST) {
    rmSync(RECORDS_DIR, { recursive: true, force: true });
    rmSync(OUT_DIR, { recursive: true, force: true });
    rmSync(`${FHE_CONTRACTS}/deployments/${FHE_NET}.json`, { force: true });
  }
  mkdirSync(`${RECORDS_DIR}/testnet`, { recursive: true });
  if (REAL && !flag("yes")) {
    say("  sending REAL transactions in 10 s (Ctrl-C to stop; --yes skips this pause)");
    await sleep(10_000);
  }
  say("  forge build (packages/contracts, fhe/contracts)");
  execFileSync("forge", ["build"], { cwd: CONTRACTS, stdio: ["ignore", "ignore", "inherit"] });
  if (!SKIP_FHE) execFileSync("forge", ["build"], { cwd: FHE_CONTRACTS, stdio: ["ignore", "ignore", "inherit"] });

  // a real broadcast compares each fresh chain with the last dry run before sending anything
  const dry = REAL ? readJson<{ totals: { chain: string; role: string; estimate: string }[] }>(`${ROOT}.stack/testnet-dryrun/report.json`) : null;
  if (REAL && !dry) say("  no dry-run report (.stack/testnet-dryrun/report.json): per-step balance checks only");

  const liveBalances: Record<string, Record<string, bigint>> = {};
  const prices: Record<string, { price: bigint; tip: bigint }> = {};
  const failed: Record<string, string> = {};
  for (const k of RUN_CHAINS) {
    say(`\n[${CHAINS[k].name}]`);
    let fork: { url: string; proc: ChildProcess } | null = null;
    try {
      const live = createPublicClient({ transport: http(CHAINS[k].publicRpc, { retryCount: 3 }) });
      liveBalances[k] = {};
      for (const r of Object.keys(EXPECTED) as Role[]) liveBalances[k]![r] = await live.getBalance({ address: EXPECTED[r] }).catch(() => -1n);
      if (!BROADCAST) fork = await startFork(k);
      const url = fork ? fork.url : (OVERRIDES[k] ?? rpcUrl(CHAINS[k], "testnet"));
      const c = await makeCtx(k, url);
      prices[k] = { price: c.price, tip: c.tip };
      say(`  rpc ${url}  ·  gas ${fmt(c.price, 9, 3)} gwei  ·  deployer balance ${fmt(await c.pub.getBalance({ address: EXPECTED.deployer }))} ${CHAINS[k].nativeSymbol}`);
      if (fork) await fundFork(c);
      if (k === "monadTestnet" && MAX_MON && REAL) {
        const est = dry?.totals.find((t) => t.chain === k && t.role === "deployer");
        if (!est) throw new Error(`--max-mon: run --dry-run first (no Monad estimate in .stack/testnet-dryrun/report.json)`);
        if (parseUnits(est.estimate, 18) > parseUnits(MAX_MON, 18)) throw new Error(`dry-run estimate ${est.estimate} MON exceeds --max-mon ${MAX_MON}`);
      }
      if (dry && !existsSync(recordPath(k))) {
        const est = dry.totals.find((t) => t.chain === k && t.role === "deployer");
        const bal = await c.pub.getBalance({ address: EXPECTED.deployer });
        if (est && bal < parseUnits(est.estimate, 18)) throw new Shortfall(k, "deployer", "whole chain (dry-run estimate)", parseUnits(est.estimate, 18), bal);
      }
      await zkCore(c);
      await privacy(c);
      await pools(c);
      if (k === "monadTestnet" && !SKIP_FHE) await fhe(c);
      if (!SKIP_MAKERS) {
        if (k === "monadTestnet") await makersHub(c);
        else await makersSpoke(c);
      }
    } catch (e) {
      failed[k] = (e as Error).message.split("\n").slice(0, 6).join("\n  ");
      say(`  ABORTED ${CHAINS[k].shortName}: ${failed[k]}`);
    } finally {
      if (fork) {
        fork.proc.kill("SIGTERM");
        await sleep(500);
      }
    }
  }
  writeOutputs(liveBalances);
  if (REAL && !failed.monadTestnet && existsSync(recordPath("monadTestnet"))) {
    try {
      execFileSync("node", ["scripts/configure.ts", "testnet"], { cwd: `${ROOT}packages/cre`, stdio: "inherit", env: { ...process.env, KAKUSHI_NETWORK: "testnet" } });
    } catch (e) {
      notes.push(`CRE configs not written: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (MAX_MON) {
    const spent = ledger.filter((x) => x.chain === "monadTestnet" && x.role === "deployer").reduce((a, x) => a + x.cost, 0n);
    if (spent > parseUnits(MAX_MON, 18)) {
      failed.monadTestnet ??= `estimate ${fmt(spent)} MON exceeds --max-mon ${MAX_MON}`;
      notes.push(`Monad deployer cost ${fmt(spent)} MON exceeds --max-mon ${MAX_MON}`);
    }
  }
  report(liveBalances, prices, failed);
  if (!BROADCAST) {
    // nothing of the simulation survives except the report
    rmSync(RECORDS_DIR, { recursive: true, force: true });
    rmSync(`${FHE_CONTRACTS}/deployments/${FHE_NET}.json`, { force: true });
    if (FORGE_BROADCAST_DIR) rmSync(FORGE_BROADCAST_DIR, { recursive: true, force: true });
  }
  if (Object.keys(failed).length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`deploy-testnet: ${(e as Error).message}`);
  process.exit(1);
});
