// Cross-checks the indexer against the chain: recomputes every aggregate from raw eth_getLogs and
// compares it with what the GraphQL API (Hasura) serves. Exit code 1 on any mismatch.
//
//   node scripts/verify.ts      env: KAKUSHI_FHE_INDEXER_URL (default http://localhost:8892/v1/graphql), KAKUSHI_FHE_RPC_URL
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Hex, type Log } from "viem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const network = process.env.KAKUSHI_FHE_NETWORK === "testnet" ? "testnet" : "local";
const RPC = process.env.KAKUSHI_FHE_RPC_URL ?? (network === "local" ? "http://127.0.0.1:18810" : "https://testnet-rpc.monad.xyz");
const GQL = process.env.KAKUSHI_FHE_INDEXER_URL ?? "http://localhost:8892/v1/graphql";
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
  "event PaymentRequested(uint256 indexed id, address indexed payee, address indexed payer, uint64 expiry, bytes32 ref, bytes32 due)",
  "event RequestPaid(uint256 indexed id, address indexed payer, bytes32 sent)",
  "event RequestCancelled(uint256 indexed id)",
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
  requests: by("PaymentRequested").length,
  requestPayAttempts: by("RequestPaid").length,
  requestsCancelled: by("RequestCancelled").length,
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

// payment requests, row by row: payee, payer, pay attempts, cancelled; and per-account request counters
const reqKey = (l: { address: string; args: { id: bigint } }) => `${lc(l.address)}-${l.args.id}`;
const expectedReq = new Map<string, { payee: string; payer: string; dueHandle: string; payAttempts: number; cancelled: boolean }>();
for (const l of by("PaymentRequested")) expectedReq.set(reqKey(l), { payee: lc(l.args.payee), payer: lc(l.args.payer), dueHandle: lc(l.args.due), payAttempts: 0, cancelled: false });
for (const l of by("RequestPaid")) {
  const r = expectedReq.get(reqKey(l));
  if (r) r.payAttempts += 1;
}
for (const l of by("RequestCancelled")) {
  const r = expectedReq.get(reqKey(l));
  if (r) r.cancelled = true;
}
const reqRows = (await gql<{ PayRequest: { requestId: string; token_id: string; payee_id: string; payer_id: string; dueHandle: string; payAttempts: number; cancelled: boolean }[] }>(
  "{ PayRequest(limit: 10000) { requestId token_id payee_id payer_id dueHandle payAttempts cancelled } }",
)).PayRequest;
const gotReq = new Map(reqRows.map((r) => [`${r.token_id.split("-")[1]}-${r.requestId}`, r]));
const reqBad = [...expectedReq].filter(([k, e]) => {
  const g = gotReq.get(k);
  return !g || g.payee_id !== e.payee || g.payer_id !== e.payer || g.dueHandle !== e.dueHandle || g.payAttempts !== e.payAttempts || g.cancelled !== e.cancelled;
});
const reqRowsOk = reqBad.length === 0 && reqRows.length === expectedReq.size;
const acctExp = new Map<string, { sent: number; recv: number }>();
for (const e of expectedReq.values()) {
  const p = acctExp.get(e.payee) ?? { sent: 0, recv: 0 };
  p.sent += 1;
  acctExp.set(e.payee, p);
  const q = acctExp.get(e.payer) ?? { sent: 0, recv: 0 };
  q.recv += 1;
  acctExp.set(e.payer, q);
}
const acctRows = (await gql<{ Account: { id: string; requestsSent: number; requestsReceived: number }[] }>(
  "{ Account(where: { _or: [{ requestsSent: { _gt: 0 } }, { requestsReceived: { _gt: 0 } }] }, limit: 10000) { id requestsSent requestsReceived } }",
)).Account;
const acctOk =
  acctRows.length === acctExp.size && acctRows.every((a) => acctExp.get(a.id)?.sent === a.requestsSent && acctExp.get(a.id)?.recv === a.requestsReceived);

// wraps, row by row (the activity feed reads them): one row per Wrapped log, same account and amount
const wrapRows = (await gql<{ Wrap: { txHash: string; logIndex: number; account_id: string; amount: string }[] }>("{ Wrap(limit: 10000) { txHash logIndex account_id amount } }")).Wrap;
const wrapGot = new Map(wrapRows.map((w) => [`${w.txHash}-${w.logIndex}`, w]));
const wrapsOk =
  wrapRows.length === by("Wrapped").length &&
  by("Wrapped").every((l) => {
    const w = wrapGot.get(`${lc(l.transactionHash!)}-${l.logIndex}`);
    return w && w.account_id === lc(l.args.account) && BigInt(w.amount) === l.args.amount;
  });

// every payRequest() move is linked to its request
const reqPays = (await gql<{ Payment: { amountHandle: string; request_id: string }[] }>("{ Payment(where: { request_id: { _is_null: false } }, limit: 10000) { amountHandle request_id } }")).Payment;
const sentToReq = new Map(by("RequestPaid").map((l) => [lc(l.args.sent), `${lc(l.address)}-${l.args.id}`]));
const reqPaysOk = reqPays.length === by("RequestPaid").length && reqPays.every((p) => p.request_id.endsWith(sentToReq.get(p.amountHandle) ?? "?"));

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
console.log(`${reqRowsOk ? "ok  " : "FAIL"}PayRequest rows: payee, payer, due handle, pay attempts, cancelled (${expectedReq.size} on chain, ${reqRows.length} indexed${reqBad.length ? `, mismatched ${reqBad.map(([k]) => k).join(", ")}` : ""})`);
console.log(`${acctOk ? "ok  " : "FAIL"}Account.requestsSent / requestsReceived (${acctExp.size} accounts with requests)`);
console.log(`${wrapsOk ? "ok  " : "FAIL"}Wrap rows: account and public amount per Wrapped log (${wrapRows.length} indexed)`);
console.log(`${reqPaysOk ? "ok  " : "FAIL"}Payment.request links: one per RequestPaid (${reqPays.length} linked)`);
ok &&= handlesOk && leak.length === 0 && reqRowsOk && acctOk && wrapsOk && reqPaysOk;
console.log(ok ? "\nALL MATCH" : "\nMISMATCH");
process.exit(ok ? 0 : 1);
