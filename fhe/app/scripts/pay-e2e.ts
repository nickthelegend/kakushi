// End-to-end check of Fhish Pay's web flows on the LOCAL FORK, through the app's own API routes.
//   node scripts/pay-e2e.ts            (app dev server on :3810, anvil fork :18810, gateway :8890)
// Drives exactly what the pages do (same contract calls, same /api/payroll/run, /api/sponsor and
// /api/faucet routes), with LOCAL ANVIL ONLY dev keys and fresh random accounts. It never touches
// Monad testnet. Prints a PASS/FAIL table and the settlement ladder of each payment.
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseEventLogs, parseSignature, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FhishClient, waitForDecryption } from "@fhish/sdk";
import { nativeEncryptor, nodeTfheEncryptor } from "@fhish/sdk/node";
import { sendRawSync, trackByTags, type CommitTimeline } from "@fhish/sdk/monad";
import { payAbi } from "../src/lib/abi.ts";
import { erc20Abi, payrollBatchTypedData, permitTypedData, withBuffer } from "../src/lib/pay/core.ts";

const APP = process.env.APP_URL ?? "http://localhost:3810";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:18810";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local.json`, "utf8"));
const apps = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local-apps.json`, "utf8"));
const TOKEN = apps.causd as Hex;
const AUSD = apps.ausd as Hex;
// LOCAL ANVIL ONLY: Foundry's public dev keys
const ALICE = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const BOB = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const CAROL = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");

const chain = defineChain({ id: 10143, name: "Monad testnet (local fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const enginePath = `${ROOT}engine/bin/fhish-engine`;
let encryptor;
try {
  readFileSync(enginePath);
  encryptor = nativeEncryptor(enginePath);
} catch {
  encryptor = nodeTfheEncryptor();
}
const fhish = new FhishClient({ gatewayUrl: process.env.FHISH_GATEWAY_URL ?? "http://127.0.0.1:8890", chainId: 10143, encryptor });

const results: { name: string; pass: boolean; detail: string }[] = [];
const ladders: string[] = [];
const fmt = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 });
const ladder = (tl: CommitTimeline) => `proposed ${tl.at.Proposed} ms · voted ${tl.at.Voted} ms · finalized ${tl.at.Finalized} ms`;

async function send(acct: PrivateKeyAccount, to: Hex, abi: any, functionName: string, args: readonly unknown[]) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const gas = withBuffer(await pub.estimateGas({ account: acct.address, to, data }));
  const [nonce, fees] = await Promise.all([pub.getTransactionCount({ address: acct.address, blockTag: "pending" }), pub.estimateFeesPerGas()]);
  const raw = await acct.signTransaction({ chainId: 10143, type: "eip1559", to, data, gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const t0 = Date.now();
  const r = await sendRawSync(pub as never, raw);
  const receipt = await pub.getTransactionReceipt({ hash: r.hash });
  const rms = Date.now() - t0;
  if (receipt.status !== "success") throw new Error(`${functionName} reverted (${r.hash})`);
  const tl = await trackByTags(pub as never, r.blockNumber, { pollMs: 50 });
  ladders.push(`${functionName.padEnd(16)} receipt ${String(rms).padStart(4)} ms${r.sync ? " (eth_sendRawTransactionSync)" : ""} · ${ladder(tl)}`);
  return receipt;
}
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${APP}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
};
const decryptAs = (acct: PrivateKeyAccount, handles: Hex[]) => fhish.userDecryptWith(handles, TOKEN, acct.address, (td) => acct.signTypedData(td as never));
const handleOf = async (who: Hex) => (await pub.readContract({ address: TOKEN, abi: payAbi, functionName: "confidentialBalanceOf", args: [who] })) as Hex;
const ausdOf = async (who: Hex) => pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [who] });
async function check(name: string, fn: () => Promise<{ pass: boolean; detail: string }>) {
  try {
    const r = await fn();
    results.push({ name, ...r });
  } catch (e) {
    results.push({ name, pass: false, detail: (e as Error).message.split("\n")[0]! });
  }
}

const t0 = Date.now();
const cfg = await (await fetch(`${APP}/api/config`)).json();
const OPERATOR = cfg.pay.operator.address as Hex;
console.log(`app ${APP} · network ${cfg.network} · cAUSD ${TOKEN} · operator ${OPERATOR} (${cfg.pay.operator.kind})`);

// fresh employees and a newcomer: brand-new keys, never funded before
const E1 = privateKeyToAccount(generatePrivateKey());
const E2 = privateKeyToAccount(generatePrivateKey());
const NEW = privateKeyToAccount(generatePrivateKey());

// 1. employer wraps AUSD with one ERC-2612 permit + wrapWithPermit (what /pay/employer does locally)
await check("Wrap (ERC-2612 permit, one tx)", async () => {
  // top up from Agora's faucet (through /api/faucet) so reruns never run dry
  if ((await ausdOf(ALICE.address)) < 5_000_000_000n) await post("/api/faucet", { address: ALICE.address, mon: false, ausd: true });
  const before = await ausdOf(ALICE.address);
  const d = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "eip712Domain" });
  const nonce = await pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "nonces", args: [ALICE.address] });
  const value = 5_000_000_000n; // covers every salary below (1,000 + 3,200 + 750), so the run needs no leftover state
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = parseSignature(await ALICE.signTypedData(permitTypedData({ chainId: 10143, token: AUSD, tokenName: d[1], tokenVersion: d[2], owner: ALICE.address, spender: TOKEN, value, nonce, deadline })));
  await send(ALICE, TOKEN, payAbi, "wrapWithPermit", [value, deadline, Number(sig.v), sig.r, sig.s]);
  const after = await ausdOf(ALICE.address);
  return { pass: before - after === value, detail: `alice moved ${fmt(value)} AUSD into cAUSD with one signature + one tx (domain "${d[1]}" v${d[2]})` };
});

// 2. direct payroll: salaries encrypted for the employer, one runPayroll tx
await check("Payroll from the employer's wallet", async () => {
  const rows: [Hex, bigint][] = [[E1.address, 1_000_000_000n], [BOB.address, 3_200_000_000n]];
  const enc = [];
  for (const [, v] of rows) enc.push(await fhish.encrypt("euint64", v, TOKEN, ALICE.address));
  const rc = await send(ALICE, TOKEN, payAbi, "runPayroll", [rows.map((r) => r[0]), enc.map((e) => e.handle), enc.map((e) => e.proof), stringToHex(`payroll e2e ${Date.now()}`, { size: 32 })]);
  const paid = parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "Paid" });
  const e1h = paid.find((p) => p.args.to.toLowerCase() === E1.address.toLowerCase())!.args.amount as Hex;
  const mine = await decryptAs(E1, [e1h]);
  let peek = "allowed";
  await decryptAs(CAROL, [e1h]).catch(() => (peek = "refused"));
  return { pass: mine[e1h.toLowerCase()] === 1_000_000_000n && peek === "refused", detail: `2 salaries in 1 tx; E1 reveals own salary ${fmt(mine[e1h.toLowerCase()]!)}; carol trying E1's salary: ${peek}` };
});

// 3. payroll operator (Privy server wallet stand-in) through POST /api/payroll/run
await check("Payroll by operator via /api/payroll/run", async () => {
  await send(ALICE, TOKEN, payAbi, "setOperator", [OPERATOR, Math.floor(Date.now() / 1000) + 86400]);
  const to = [E2.address];
  const enc = await fhish.encrypt("euint64", 750_000_000n, TOKEN, OPERATOR); // bound to the operator, the tx sender
  const ref = stringToHex(`payroll op ${Date.now()}`, { size: 32 }); // the contract pays each (employer, ref) once
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const td = payrollBatchTypedData({ chainId: 10143, token: TOKEN, employer: ALICE.address, operator: OPERATOR, to, amounts: [enc.handle], ref, deadline });
  const signature = await ALICE.signTypedData(td);
  const body = { employer: ALICE.address, to, amounts: [enc.handle], proofs: [enc.proof], ref, deadline: deadline.toString(), signature };
  // negative: a batch signed by someone else must be refused
  const forged = await post("/api/payroll/run", { ...body, signature: await CAROL.signTypedData(td) });
  // negative: an employer who never authorized the operator
  const tdBob = payrollBatchTypedData({ ...{ chainId: 10143, token: TOKEN, operator: OPERATOR, to, amounts: [enc.handle], ref, deadline }, employer: BOB.address });
  await send(BOB, TOKEN, payAbi, "setOperator", [OPERATOR, 0]);
  const unauth = await post("/api/payroll/run", { ...body, employer: BOB.address, signature: await BOB.signTypedData(tdBob) });
  const t = Date.now();
  const ok = await post("/api/payroll/run", body);
  const rms = Date.now() - t;
  if (ok.status !== 200) throw new Error(`operator run failed: ${ok.status} ${ok.j.error}`);
  const tl = await trackByTags(pub as never, BigInt(ok.j.blockNumber), { pollMs: 50 });
  ladders.push(`runPayrollFrom   receipt ${String(rms).padStart(4)} ms via the app's operator route · ${ladder(tl)}`);
  const replay = await post("/api/payroll/run", body);
  const h = await handleOf(E2.address);
  const v = await decryptAs(E2, [h]);
  return {
    pass: forged.status === 401 && unauth.status === 409 && replay.status === 409 && v[h.toLowerCase()] === 750_000_000n,
    detail: `operator ${ok.j.via} paid E2 ${fmt(v[h.toLowerCase()]!)} (E2's own reveal); forged batch ${forged.status}, unauthorized employer ${unauth.status}, replay ${replay.status}`,
  };
});

// 4. pay link: bob escrows 250 behind a one-time key; a brand-new account claims through /api/sponsor
await check("Pay link → new account (sponsored claim)", async () => {
  const key = generatePrivateKey();
  const claimKey = privateKeyToAccount(key).address;
  const enc = await fhish.encrypt("euint64", 250_000_000n, TOKEN, BOB.address);
  const rc = await send(BOB, TOKEN, payAbi, "createLink", [enc.handle, enc.proof, claimKey, BigInt(Math.floor(Date.now() / 1000) + 7 * 86400)]);
  const id = parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "LinkCreated" })[0]!.args.id;
  const digest = (await pub.readContract({ address: TOKEN, abi: payAbi, functionName: "claimDigest", args: [id, NEW.address] })) as Hex;
  const sig = await privateKeyToAccount(key).sign({ hash: digest });
  // a front-runner replaying the signature for themselves must fail
  const stolen = await post("/api/sponsor", { to: TOKEN, data: encodeFunctionData({ abi: payAbi, functionName: "claimLink", args: [id, CAROL.address, sig] }) });
  // anything but claimLink is refused by the sponsor
  const other = await post("/api/sponsor", { to: TOKEN, data: encodeFunctionData({ abi: payAbi, functionName: "setOperator", args: [CAROL.address, 1] }) });
  const t = Date.now();
  const ok = await post("/api/sponsor", { to: TOKEN, data: encodeFunctionData({ abi: payAbi, functionName: "claimLink", args: [id, NEW.address, sig] }) });
  const rms = Date.now() - t;
  if (ok.status !== 200) throw new Error(`sponsor: ${ok.status} ${ok.j.error}`);
  const tl = await trackByTags(pub as never, BigInt(ok.j.blockNumber), { pollMs: 50 });
  ladders.push(`claimLink        receipt ${String(rms).padStart(4)} ms via the app's sponsor route · ${ladder(tl)}`);
  const monNew = await pub.getBalance({ address: NEW.address });
  const h = await handleOf(NEW.address);
  const v = await decryptAs(NEW, [h]);
  return { pass: stolen.status !== 200 && other.status === 403 && v[h.toLowerCase()] === 250_000_000n && monNew === 0n, detail: `link #${id}: newcomer (0 MON) reveals ${fmt(v[h.toLowerCase()]!)}; redirect attempt ${stolen.status} (${stolen.j.error?.slice(0, 40)}…); non-claim call ${other.status}` };
});

// 5. private payment with a public reference
await check("Private payment with reference", async () => {
  const enc = await fhish.encrypt("euint64", 42_000_000n, TOKEN, BOB.address);
  const rc = await send(BOB, TOKEN, payAbi, "pay", [CAROL.address, enc.handle, enc.proof, stringToHex("Invoice 0042", { size: 32 })]);
  const p = parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "Paid" })[0]!;
  const v = await decryptAs(CAROL, [p.args.amount as Hex]);
  return { pass: v[(p.args.amount as Hex).toLowerCase()] === 42_000_000n, detail: `carol reveals ${fmt(v[(p.args.amount as Hex).toLowerCase()]!)} from the Paid event; ref "Invoice 0042" is public` };
});

// 6. cash out: E1 (a fresh account) gets fork gas from /api/faucet and unwraps 400
await check("Cash out (unwrap via KMS callback)", async () => {
  const f = await post("/api/faucet", { address: E1.address, mon: true });
  if (f.status !== 200) throw new Error(`faucet ${f.status}`);
  const before = await ausdOf(E1.address);
  const enc = await fhish.encrypt("euint64", 400_000_000n, TOKEN, E1.address);
  const rc = await send(E1, TOKEN, payAbi, "unwrap", [enc.handle, enc.proof]);
  const id = parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "UnwrapRequested" })[0]!.args.requestId;
  const t = Date.now();
  await waitForDecryption(pub as never, dep.oracle, id);
  const after = await ausdOf(E1.address);
  const h = await handleOf(E1.address);
  const left = await decryptAs(E1, [h]);
  return { pass: after - before === 400_000_000n && left[h.toLowerCase()] === 600_000_000n, detail: `E1 received ${fmt(after - before)} real AUSD ${Date.now() - t} ms after the request; private balance left ${fmt(left[h.toLowerCase()]!)}` };
});

// 7. payment request: carol asks bob for 75 (encrypted for carol); bob reveals it, pays; carol sees 0 owed
const reqExpiry = async () => (await pub.getBlock()).timestamp + 86400n; // chain time: the fork can run ahead
async function request(payee: PrivateKeyAccount, payer: Hex, amount: bigint, label: string) {
  const enc = await fhish.encrypt("euint64", amount, TOKEN, payee.address); // bound to the payee: the tx sender
  const rc = await send(payee, TOKEN, payAbi, "requestPayment", [payer, enc.handle, enc.proof, await reqExpiry(), stringToHex(label, { size: 32 })]);
  return parseEventLogs({ abi: payAbi, logs: rc.logs, eventName: "PaymentRequested" })[0]!.args.id;
}
const dueOf = async (id: bigint) => (await pub.readContract({ address: TOKEN, abi: payAbi, functionName: "requestDue", args: [id] })) as Hex;
/** the custom error a call would revert with (what the app's explain() maps to friendly text) */
async function revertName(acct: PrivateKeyAccount, functionName: string, args: readonly unknown[]) {
  try {
    await pub.estimateContractGas({ address: TOKEN, abi: payAbi, functionName, args, account: acct.address } as never);
    return "no revert";
  } catch (e) {
    const rev = (e as BaseError).walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return rev?.data?.errorName ?? (e as Error).message.split("\n")[0]!;
  }
}
await check("Payment request → payer pays → owed 0", async () => {
  const id = await request(CAROL, BOB.address, 75_000_000n, "rent e2e");
  const due0 = await dueOf(id);
  const bobSees = (await decryptAs(BOB, [due0]))[due0.toLowerCase()];
  let peek = "allowed";
  await decryptAs(ALICE, [due0]).catch(() => (peek = "refused"));
  const notPayer = await revertName(CAROL, "payRequest", [id]);
  const notPayee = await revertName(BOB, "cancelRequest", [id]);
  const selfAsk = await revertName(CAROL, "requestPayment", [CAROL.address, due0, "0x", await reqExpiry(), stringToHex("x", { size: 32 })]);
  const [hc0, hb0] = [await handleOf(CAROL.address), await handleOf(BOB.address)];
  const carolBefore = (await decryptAs(CAROL, [hc0]))[hc0.toLowerCase()]!;
  const bobBefore = (await decryptAs(BOB, [hb0]))[hb0.toLowerCase()]!;
  await send(BOB, TOKEN, payAbi, "payRequest", [id]);
  const due1 = await dueOf(id);
  const carolOwed = (await decryptAs(CAROL, [due1]))[due1.toLowerCase()];
  const [hc1, hb1] = [await handleOf(CAROL.address), await handleOf(BOB.address)];
  const carolAfter = (await decryptAs(CAROL, [hc1]))[hc1.toLowerCase()]!;
  const bobAfter = (await decryptAs(BOB, [hb1]))[hb1.toLowerCase()]!;
  const [, , , cancelled] = (await pub.readContract({ address: TOKEN, abi: payAbi, functionName: "payRequests", args: [id] })) as readonly [Hex, Hex, bigint, boolean, Hex];
  return {
    pass: bobSees === 75_000_000n && peek === "refused" && carolOwed === 0n && carolAfter - carolBefore === 75_000_000n && bobBefore - bobAfter === 75_000_000n && !cancelled && notPayer === "NotPayer" && notPayee === "NotPayee" && selfAsk === "BadPayer",
    detail: `#${id}: bob reveals ${fmt(bobSees!)}, pays; carol now sees owed ${fmt(carolOwed!)} and +${fmt(carolAfter - carolBefore)} (bob −${fmt(bobBefore - bobAfter)}); alice peeking: ${peek}; carol paying ${notPayer}, bob cancelling ${notPayee}, self-request ${selfAsk}`,
  };
});

// 8. an unaffordable request: E2 (750 private) is asked for 1,000,000; paying moves nothing and it stays owed
await check("Unaffordable request stays owed, then cancelled", async () => {
  const f = await post("/api/faucet", { address: E2.address, mon: true });
  if (f.status !== 200) throw new Error(`faucet ${f.status}`);
  const id = await request(CAROL, E2.address, 1_000_000_000_000n, "too much e2e");
  const he0 = await handleOf(E2.address);
  const e2Before = (await decryptAs(E2, [he0]))[he0.toLowerCase()]!;
  await send(E2, TOKEN, payAbi, "payRequest", [id]); // succeeds: an encrypted 0 moves
  const due = await dueOf(id);
  const owedE2 = (await decryptAs(E2, [due]))[due.toLowerCase()];
  const owedCarol = (await decryptAs(CAROL, [due]))[due.toLowerCase()];
  const he1 = await handleOf(E2.address);
  const e2After = (await decryptAs(E2, [he1]))[he1.toLowerCase()]!;
  await send(CAROL, TOKEN, payAbi, "cancelRequest", [id]);
  const afterCancel = await revertName(E2, "payRequest", [id]);
  return {
    pass: owedE2 === 1_000_000_000_000n && owedCarol === owedE2 && e2After === e2Before && afterCancel === "RequestNotOpen",
    detail: `#${id}: E2 holds ${fmt(e2Before)}, pays a 1,000,000 request: still owed ${fmt(owedE2!)} (carol sees the same), E2's balance unchanged ${fmt(e2After)}; after carol cancels, paying reverts ${afterCancel}`,
  };
});

console.log(`\nFhish Pay web flows on the local fork (${Math.round((Date.now() - t0) / 1000)} s)`);
for (const r of results) console.log(`${r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.name.padEnd(48)} ${r.detail}`);
console.log("\nsettlement ladders (local fork: latest / safe / finalized tags, 1 s blocks; ms after the receipt):");
for (const l of ladders) console.log(`  ${l}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
