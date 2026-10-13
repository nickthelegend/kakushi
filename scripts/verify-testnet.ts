// Verify every Kakushi contract on a testnet with Sourcify (MonadVision reads Sourcify).
//
//   node scripts/verify-testnet.ts [--chain 10143|11155111|84532] [--verifier-url …]
//
// Monad (the default) uses MonadVision's Sourcify; other chains the public sourcify.dev server.
//
// Reads the committed records (packages/contracts/deployments/testnet/10143.json, config/generated/
// fhe.testnet.json) and the forge broadcast files for the linked libraries, then runs
// `forge verify-contract --verifier sourcify --chain 10143` per contract (no keys involved).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ZK = `${ROOT}packages/contracts`;
const FHE = `${ROOT}fhe/contracts`;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const CHAIN = arg("chain") ?? "10143";
const URL_ = arg("verifier-url") ?? (CHAIN === "10143" ? "https://sourcify-api-monad.blockvision.org" : "https://sourcify.dev/server");
const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

interface Item {
  project: string;
  address: string;
  id: string;
}
const items: Item[] = [];
const add = (project: string, address: string | undefined, id: string) => {
  if (address && /^0x[0-9a-fA-F]{40}$/.test(address) && !items.some((x) => x.address.toLowerCase() === address.toLowerCase())) items.push({ project, address, id });
};

const hub = readJson(`${ZK}/deployments/testnet/${CHAIN}.json`);
if (!hub) throw new Error(`no record: packages/contracts/deployments/testnet/${CHAIN}.json`);
add(ZK, hub.payoutRouter, "src/PayoutRouter.sol:PayoutRouter");
add(ZK, hub.sourceRouter, "src/SourceRouter.sol:SourceRouter");
add(ZK, hub.ebc, "src/EBC.sol:EBC");
add(ZK, hub.mdc, "src/MDC.sol:MDC");
add(ZK, hub.attestationOracle, "src/AttestationOracle.sol:AttestationOracle");
add(ZK, hub.disputeModule, "src/DisputeModule.sol:DisputeModule");
add(ZK, hub.complianceVerifier, "src/verifiers/PaymentComplianceVerifier.sol:PaymentComplianceVerifier");
add(ZK, hub.inclusionVerifier, "src/verifiers/PayoutInclusionVerifier.sol:PayoutInclusionVerifier");
const p = hub.privacy ?? {};
add(ZK, p.stealthRegistry, "src/privacy/StealthRegistry.sol:StealthRegistry");
add(ZK, p.stealthAnnouncer, "src/privacy/StealthAnnouncer.sol:StealthAnnouncer");
add(ZK, p.stealthPay, "src/privacy/StealthPay.sol:StealthPay");
add(ZK, p.shieldedVerifier, "src/verifiers/ShieldedWithdrawVerifier.sol:ShieldedWithdrawVerifier");
add(ZK, p.poolFactory, "src/privacy/KakushiPoolFactory.sol:KakushiPoolFactory");
// factory pools are recorded in the generated deployments, curated ones in the forge record
const generated = readJson(`${ROOT}config/generated/deployments.testnet.json`)?.chains?.[CHAIN]?.privacy?.pools ?? {};
for (const pool of Object.values({ ...(p.pools ?? {}), ...generated } as Record<string, { address: string }>)) add(ZK, pool.address, "src/privacy/KakushiPool.sol:KakushiPool");

// linked libraries (verifiers): "path:Name:address" entries of the broadcast files
const libs: Record<string, string[]> = {};
for (const [project, scripts] of [[ZK, ["Deploy.s.sol", "DeployPrivacy.s.sol"]], [FHE, ["Deploy.s.sol"]]] as const) {
  for (const s of scripts) {
    const run = readJson(`${project}/broadcast/${s}/${CHAIN}/run-latest.json`);
    for (const l of (run?.libraries ?? []) as string[]) {
      const [path, name, address] = l.split(":");
      (libs[path!] ??= []).push(l);
      add(project, address, `${path}:${name}`);
    }
  }
}

const fhe = CHAIN === "10143" ? readJson(`${ROOT}config/generated/fhe.testnet.json`) : null;
if (fhe) {
  add(FHE, fhe.core.registry, "src/lib/KakushiRegistry.sol:KakushiRegistry");
  add(FHE, fhe.core.acl, "src/lib/KakushiACL.sol:KakushiACL");
  add(FHE, fhe.core.executor, "src/lib/KakushiExecutor.sol:KakushiExecutor");
  add(FHE, fhe.core.inputVerifier, "src/lib/KakushiInputVerifier.sol:KakushiInputVerifier");
  add(FHE, fhe.core.oracle, "src/oracle/KakushiDecryptionOracle.sol:KakushiDecryptionOracle");
  for (const t of fhe.tokens as { address: string }[]) add(FHE, t.address, "src/examples/Examples.sol:KakushiPayToken");
  add(FHE, fhe.stealthPay, "src/apps/ConfidentialStealthPay.sol:ConfidentialStealthPay");
}

/** Sourcify's final word: exact_match (metadata too), match (bytecode), or null */
async function matchOf(address: string): Promise<string | null> {
  try {
    const r = await fetch(`${URL_}/v2/contract/${CHAIN}/${address}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return ((await r.json()) as { match?: string | null }).match ?? null;
  } catch {
    return null;
  }
}

const results: { address: string; id: string; status: string }[] = [];
for (const it of items) {
  const before = await matchOf(it.address);
  if (before) {
    results.push({ address: it.address, id: it.id.split(":")[1]!, status: before });
    console.log(`${it.id.split(":")[1]!.padEnd(28)} ${it.address}  ${before} (already)`);
    continue;
  }
  const path = it.id.split(":")[0]!;
  const args = ["verify-contract", it.address, it.id, "--chain", CHAIN, "--verifier", "sourcify", "--verifier-url", URL_];
  for (const l of libs[path] ?? []) args.push("--libraries", l);
  let status: string;
  try {
    const out = execFileSync("forge", args, { cwd: it.project, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 180_000 });
    status = `submitted (${out.trim().split("\n").pop()?.trim()})`;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    status = /already verified/i.test(text) ? "already verified" : `FAILED: ${text.trim().split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 240)}`;
  }
  if (!status.startsWith("FAILED")) {
    // the v2 API verifies asynchronously: wait for the job's verdict
    for (let n = 0; n < 30; n++) {
      const m = await matchOf(it.address);
      if (m) {
        status = m;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (status.startsWith("submitted")) status = `FAILED: no match after 60 s, ${status}`;
  }
  results.push({ address: it.address, id: it.id.split(":")[1]!, status });
  console.log(`${it.id.split(":")[1]!.padEnd(28)} ${it.address}  ${status}`);
}
const ok = results.filter((r) => !r.status.startsWith("FAILED")).length;
console.log(`\n${ok}/${results.length} verified on Sourcify (chain ${CHAIN})`);
if (ok < results.length) process.exitCode = 1;
