// Cross-checks the indexer against the chain: recomputes every aggregate from raw eth_getLogs and
// compares it with what the GraphQL API (Hasura) serves. Exit code 1 on any mismatch.
//
//   node scripts/verify.ts      env: FHISH_INDEXER_URL (default http://localhost:8892/v1/graphql), FHISH_RPC_URL
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Hex, type Log } from "viem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const network = process.env.FHISH_NETWORK === "testnet" ? "testnet" : "local";
const RPC = process.env.FHISH_RPC_URL ?? (network === "local" ? "http://127.0.0.1:18810" : "https://testnet-rpc.monad.xyz");
const GQL = process.env.FHISH_INDEXER_URL ?? "http://localhost:8892/v1/graphql";
const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/${network}.json`, "utf8"));
const { TOKENS } = await import("../src/network.generated.ts");
const tokens = Object.keys(TOKENS) as Hex[];
const pub = createPublicClient({ transport: http(RPC) });

async function gql<T>(query: string): Promise<T> {
  const r = await fetch(GQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!j.data) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const head = await gql<{ chain_metadata: { latest_processed_block: number; start_block: number }[] }>("{ chain_metadata { latest_processed_block start_block } }");
const toBlock = BigInt(head.chain_metadata[0]!.latest_processed_block);
const fromBlock = BigInt(head.chain_metadata[0]!.start_block);

const payEv = parseAbi([
  "event Wrapped(address indexed account, uint256 amount)",
  "event UnwrapRequested(uint256 indexed requestId, address indexed account)",
  "event Unwrapped(uint256 indexed requestId, address indexed account, uint256 amount)",
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
  "event Paid(address indexed from, address indexed to, bytes32 amount, bytes32 indexed ref)",
  "event LinkCreated(uint256 indexed id, address indexed sender, address claimKey, uint64 expiry, bytes32 amount)",
  "event LinkClaimed(uint256 indexed id, address indexed to)",
  "event LinkRefunded(uint256 indexed id)",
  "event PayrollRun(address indexed employer, address indexed operator, uint256 count, bytes32 indexed ref)",
]);
const oracleEv = parseAbi([
  "event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)",
  "event DecryptionFulfilled(uint256 indexed requestId, uint256[] cleartexts, bool callbackOk, address via)",
]);
const execEv = parseAbi([
  "event FheOp(uint8 indexed op, bytes32 result, bytes32 lhs, bytes32 rhs, bool scalar, address indexed caller)",
  "event FheSelect(bytes32 result, bytes32 control, bytes32 ifTrue, bytes32 ifFalse, address indexed caller)",
  "event TrivialEncrypt(bytes32 result, uint256 value, uint8 toType)",
  "event VerifyInput(bytes32 result, bytes32 inputHandle, address indexed user, address indexed caller)",
  "event Rand(bytes32 result, uint256 upperBound, bytes32 seed, uint8 randType)",
]);

async function logs(address: Hex | Hex[], events: any) {
  const out: any[] = [];
  for (let b = fromBlock; b <= toBlock; b += 2000n) {
    const to = b + 1999n > toBlock ? toBlock : b + 1999n;
    out.push(...(await pub.getLogs({ address, events, fromBlock: b, toBlock: to, strict: true } as never)));
  }
  return out as (Log & { eventName: string; args: any })[];
}
const pay = await logs(tokens, payEv);
const ora = await logs(dep.oracle, oracleEv);
const exe = await logs(dep.executor, execEv);
const ZERO = "0x0000000000000000000000000000000000000000";
const by = (n: string) => pay.filter((l) => l.eventName === n);
const lc = (s: string) => s.toLowerCase();

// payments, recomputed the way the protocol defines them
const paidHandles = new Set(by("Paid").map((l) => lc(l.args.amount)));
const payrollKeys = new Set(by("PayrollRun").map((l) => `${l.transactionHash}|${lc(l.args.employer)}|${l.args.ref}`));
const payroll = by("Paid").filter((l) => payrollKeys.has(`${l.transactionHash}|${lc(l.args.from)}|${l.args.ref}`)).length;
const transfers = by("ConfidentialTransfer").filter((l) => {
  const [f, t, src] = [lc(l.args.from), lc(l.args.to), lc(l.address)];
  return f !== ZERO && t !== ZERO && f !== src && t !== src && !paidHandles.has(lc(l.args.amount));
}).length;
const sum = (n: string) => by(n).reduce((a, l) => a + (l.args.amount as bigint), 0n);
const reqs = ora.filter((l) => l.eventName === "DecryptionRequested");
const fuls = ora.filter((l) => l.eventName === "DecryptionFulfilled");
const blockTs = new Map<bigint, bigint>();
const ts = async (b: bigint) => blockTs.get(b) ?? (blockTs.set(b, (await pub.getBlock({ blockNumber: b })).timestamp), blockTs.get(b)!);
let latS = 0n;
let latB = 0n;
for (const f of fuls) {
  const r = reqs.find((q) => q.args.requestId === f.args.requestId)!;
  latB += f.blockNumber! - r.blockNumber!;
  latS += (await ts(f.blockNumber!)) - (await ts(r.blockNumber!));
}

const expected: Record<string, string | number> = {
  payments: by("Paid").length + transfers + by("LinkClaimed").length,
  pays: by("Paid").length - payroll,
  payrollPayments: payroll,
  transfers,
  linkClaims: by("LinkClaimed").length,
  payrollRuns: by("PayrollRun").length,
  linksCreated: by("LinkCreated").length,
  linksClaimed: by("LinkClaimed").length,
  linksRefunded: by("LinkRefunded").length,
  linksOpen: by("LinkCreated").length - by("LinkClaimed").length - by("LinkRefunded").length,
  wraps: by("Wrapped").length,
  unwrapsRequested: by("UnwrapRequested").length,
  unwrapsSettled: by("Unwrapped").length,
  publicWrapped: sum("Wrapped").toString(),
  publicUnwrapped: sum("Unwrapped").toString(),
  publicTvl: (sum("Wrapped") - sum("Unwrapped")).toString(),
  reveals: reqs.length,
  revealsFulfilled: fuls.length,
  revealLatencySecondsTotal: Number(latS),
  revealLatencyBlocksTotal: Number(latB),
  fheOps: exe.length,
  fheInputsVerified: exe.filter((l) => l.eventName === "VerifyInput").length,
};
const fields = Object.keys(expected).join(" ");
const got = (await gql<{ GlobalStats: Record<string, string | number>[] }>(`{ GlobalStats { ${fields} } }`)).GlobalStats[0]!;

// privacy: every payment amount is a 32-byte handle, and no revealed cleartext appears in Payment/Reveal rows
const rows = await gql<{ Payment: { amountHandle: string }[]; Reveal: Record<string, unknown>[] }>("{ Payment { amountHandle } Reveal { requestId requester app handlesCount callback status via path callbackOk latencySeconds latencyBlocks } }");
const handlesOk = rows.Payment.every((p) => /^0x[0-9a-f]{64}$/.test(p.amountHandle));
const clear = new Set(fuls.flatMap((f) => (f.args.cleartexts as bigint[]).map(String)).filter((c) => c.length > 3));
const leak = JSON.stringify(rows).match(/\d{4,}/g)?.filter((d) => clear.has(d)) ?? [];

let ok = true;
console.log(`blocks ${fromBlock}..${toBlock} · ${pay.length} token logs, ${ora.length} oracle logs, ${exe.length} executor logs\n`);
console.log("aggregate".padEnd(28) + "chain".padStart(14) + "indexer".padStart(14));
for (const k of Object.keys(expected)) {
  const same = String(expected[k]) === String(got[k]);
  ok &&= same;
  console.log(`${same ? "ok  " : "FAIL"}${k.padEnd(24)}${String(expected[k]).padStart(14)}${String(got[k]).padStart(14)}`);
}
console.log(`${handlesOk ? "ok  " : "FAIL"}payment amounts are 32-byte ciphertext handles (${rows.Payment.length} rows)`);
console.log(`${leak.length === 0 ? "ok  " : "FAIL"}no oracle cleartext appears in Payment/Reveal rows (${clear.size} distinct cleartexts checked)`);
ok &&= handlesOk && leak.length === 0;
console.log(ok ? "\nALL MATCH" : "\nMISMATCH");
process.exit(ok ? 0 : 1);
