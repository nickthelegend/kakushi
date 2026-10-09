// pnpm demo — the judge path, end to end, on the local forks (real contracts, real signed
// transactions, real Noir proofs; Chainlink CRE logic via the local runner, labelled).
//
//   A  USDC Sepolia -> Monad, filled by the best-quoting Maker
//   B  Maker A goes down; a payment to it is never filled; the Watchtower proves the absence
//      over CRE-attested windows and slashes Maker A's margin back to the sender. Meanwhile
//      Maker B keeps filling new transfers (it is a market, not one operator)
//   C  a mistyped ident code (9999): the Maker refunds on the source chain, no loss
//   D  native ETH Sepolia -> Base Sepolia (raw value transfer, code in the wei)
//   E  USDC Arbitrum Sepolia -> Monad      (only when the optional Arbitrum Sepolia fork is deployed)
//   F  native ETH Sepolia -> OP Sepolia    (only when the optional OP Sepolia fork is deployed)
//      Start them with KAKUSHI_EXTRA_FORKS=all pnpm stack:up (or let the demo start the stack).
//
// Flags: --keep (leave stack and services running), --no-deploy (reuse the current deployment)
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, appendFileSync, writeFileSync } from "node:fs";
import { type Hex, formatUnits, parseUnits, zeroAddress } from "viem";
import { CHAINS, type ChainKey } from "@kakushi/config";
import { Kakushi, buildGross, buildTransferTx, erc20Abi, findPayout, findSourcePayment, srcRefOf, walletClient, publicClient } from "@kakushi/sdk";
import { loadDeployments } from "@kakushi/config/deployments";
import { LOCAL_KEYS, localAccount } from "./local-accounts.ts";

process.env.KAKUSHI_NETWORK = "local";
const args = new Set(process.argv.slice(2));
const children: ChildProcess[] = [];
let ownsStack = false;
let keepSuccessfulStack = false;
let expected = 4; // scenarios this run must pass (E/F join when their forks are deployed)
const results: { scenario: string; pass: boolean; detail: string }[] = [];
const t0 = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const ADMIN = "kakushi-local-demo";

function stack(cmd: "up" | "down" | "status"): string {
  return execFileSync("bash", ["scripts/stack.sh", cmd], { encoding: "utf8" });
}

function start(name: string, cmd: string, argv: string[], env: Record<string, string>, cwd = "."): ChildProcess {
  mkdirSync(".stack", { recursive: true });
  const out = openSync(`.stack/${name}.log`, "w");
  const c = spawn(cmd, argv, { cwd, env: { ...process.env, KAKUSHI_NETWORK: "local", ...env }, stdio: ["ignore", out, out] });
  children.push(c);
  if (c.pid) appendFileSync(".stack/demo-pids", `${name} ${c.pid}\n`);
  return c;
}

async function waitHttp(url: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms: number, every = 1000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(every);
  }
  throw new Error(`timeout: ${what}`);
}

async function main() {
  for (const port of [3711, 3712, 3713, 3714]) {
    try { execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" }); }
    catch { continue; }
    throw new Error(`port ${port} already occupied; leave existing services untouched`);
  }
  mkdirSync(".stack", { recursive: true });
  writeFileSync(".stack/demo-pids", "");
  if (!stack("status").includes(" up")) {
    say(`starting local forks (Monad testnet hub, Sepolia, Base Sepolia${process.env.KAKUSHI_EXTRA_FORKS ? ` + ${process.env.KAKUSHI_EXTRA_FORKS}` : ""})`);
    console.log(stack("up").trim());
    ownsStack = true;
  }
  if (!args.has("--no-deploy")) {
    say("deploying Kakushi and seeding a two-Maker market");
    execFileSync("node", ["scripts/deploy-local.ts"], { stdio: "inherit", env: { ...process.env, KAKUSHI_NETWORK: "local" } });
  }
  const d = loadDeployments("local");
  const k = new Kakushi({ network: "local", deployments: d });
  const hasArbitrum = d.chains[CHAINS.arbitrumSepolia.chainId] !== undefined;
  const hasOp = d.chains[CHAINS.opSepolia.chainId] !== undefined;
  expected = 4 + Number(hasArbitrum) + Number(hasOp);

  say("starting services: local CRE runner, Maker A, Maker B, Watchtower");
  start("attester", "node", ["local/runner.ts"], { KAKUSHI_ATTEST_INTERVAL: "6", KAKUSHI_ATTEST_VERBOSE: "1" }, "packages/cre");
  const ts = Date.now();
  const makerA = start("maker-a", "node", ["src/main.ts"], { MAKER_NAME: "Maker A", MAKER_KEY: LOCAL_KEYS.makerA, MAKER_PORT: "3711", MAKER_ADMIN_TOKEN: ADMIN, MAKER_DB: `../../.data/demo-maker-a-${ts}.sqlite` }, "packages/maker");
  start("maker-b", "node", ["src/main.ts"], { MAKER_NAME: "Maker B", MAKER_KEY: LOCAL_KEYS.makerB, MAKER_PORT: "3712", MAKER_ADMIN_TOKEN: ADMIN, MAKER_DB: `../../.data/demo-maker-b-${ts}.sqlite` }, "packages/maker");
  start("watchtower", "node", ["src/main.ts"], { WATCHTOWER_KEY: LOCAL_KEYS.watchtower, WATCHTOWER_PORT: "3713", WATCHTOWER_DB: `../../.data/demo-watchtower-${ts}.sqlite` }, "packages/watchtower");
  await Promise.all(["http://127.0.0.1:3714/status", "http://127.0.0.1:3711/health", "http://127.0.0.1:3712/health", "http://127.0.0.1:3713/health"].map((u) => waitHttp(u)));
  await sleep(3000); // let watchers take their first cursors

  const user = localAccount("user");
  const makerUrls = ["http://127.0.0.1:3711", "http://127.0.0.1:3712"];
  const sepolia = publicClient("sepolia", "local");
  const monad = publicClient("monadTestnet", "local");
  const userSep = walletClient("sepolia", LOCAL_KEYS.user, "local");
  const usdcMonad = CHAINS.monadTestnet.usdc.address;
  const bal = (c: typeof monad, token: Hex, who: Hex) => c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;

  async function pay(maker: Hex, amount: bigint, code?: number, native = false) {
    const dst = native ? CHAINS.baseSepolia.chainId : CHAINS.monadTestnet.chainId;
    const gross = code === undefined ? buildGross(amount, dst).gross : amount - (amount % 10_000n) + BigInt(code);
    const token = native ? zeroAddress : CHAINS.sepolia.usdc.address;
    const tx = buildTransferTx(k, { srcChainId: CHAINS.sepolia.chainId, token, maker, gross, sender: user.address });
    const marks = { monad: await monad.getBlockNumber(), sepolia: await sepolia.getBlockNumber(), base: await publicClient("baseSepolia", "local").getBlockNumber() };
    const hash = await userSep.sendTransaction({ chain: userSep.chain, account: user, to: tx.to as Hex, data: tx.data, value: tx.value ?? 0n });
    await sepolia.waitForTransactionReceipt({ hash });
    const p = await findSourcePayment(k, CHAINS.sepolia.chainId, hash);
    if (!p) throw new Error("payment not recognized");
    return { hash, p, gross, sentAt: Date.now(), marks };
  }

  /** A raw transfer on `src` coded for `dst` (USDC or native), with block marks on `dst`. */
  async function payRoute(src: ChainKey, dst: ChainKey, maker: Hex, amount: bigint, native: boolean) {
    const sc = publicClient(src, "local");
    const dc = publicClient(dst, "local");
    const w = walletClient(src, LOCAL_KEYS.user, "local");
    const { gross } = buildGross(amount, CHAINS[dst].chainId);
    const tx = buildTransferTx(k, { srcChainId: CHAINS[src].chainId, token: native ? zeroAddress : CHAINS[src].usdc.address, maker, gross, sender: user.address });
    const mark = await dc.getBlockNumber();
    const hash = await w.sendTransaction({ chain: w.chain, account: user, to: tx.to as Hex, data: tx.data, value: tx.value ?? 0n });
    await sc.waitForTransactionReceipt({ hash });
    const p = await findSourcePayment(k, CHAINS[src].chainId, hash);
    if (!p) throw new Error("payment not recognized");
    return { hash, p, gross, mark };
  }

  // ---------------------------------------------------------------- A
  try {
    say("A · 5 USDC Sepolia -> Monad");
    const quotes = await k.quote({ srcChainId: CHAINS.sepolia.chainId, dstChainId: CHAINS.monadTestnet.chainId, token: "USDC", amount: parseUnits("5", 6), makerUrls });
    const best = quotes.find((q) => q.quotable);
    if (!best) throw new Error(`no quotable Maker: ${JSON.stringify(quotes.map((q) => q.reason))}`);
    console.log(quotes.map((q) => `  ${q.name}: net ${formatUnits(BigInt(q.net), 6)} USDC${q.quotable ? "" : ` (${q.reason})`}`).join("\n"));
    const before = await bal(monad, usdcMonad, user.address);
    const { hash, p, gross, sentAt, marks } = await pay(best.maker, parseUnits("5", 6));
    console.log(`  sent ${gross} units (code ${gross % 10_000n} in the last 4 digits) to ${best.name}: ${hash}`);
    const payout = await waitFor("fill", () => findPayout(monad, d.chains[CHAINS.monadTestnet.chainId]!.payoutRouter, srcRefOf(p), best.maker, marks.monad), 60_000, 300);
    const after = await bal(monad, usdcMonad, user.address);
    const ok = after - before === BigInt(best.net);
    results.push({ scenario: "A fill USDC Sepolia->Monad", pass: ok, detail: `received ${formatUnits(after - before, 6)} USDC on Monad ${((Date.now() - sentAt) / 1000).toFixed(1)} s after the source receipt (payout ${payout.txHash.slice(0, 12)})` });
  } catch (e) {
    results.push({ scenario: "A fill USDC Sepolia->Monad", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- B
  if (args.has("--no-proof")) {
    expected -= 1;
    say("B · skipped (--no-proof: this run generates no ZK proof, for low-memory machines)");
  } else try {
    say("B · Maker A goes down; its unpaid transfer is slashed back to the sender");
    makerA.kill("SIGTERM");
    await sleep(1000);
    const before = await bal(monad, usdcMonad, user.address);
    const { hash, p, gross } = await pay(localAccount("makerA").address, parseUnits("7", 6));
    console.log(`  paid ${gross} units to Maker A (offline): ${hash}`);
    const b = await pay(localAccount("makerB").address, parseUnits("2", 6));
    const bFill = await waitFor("maker B fill", () => findPayout(monad, d.chains[CHAINS.monadTestnet.chainId]!.payoutRouter, srcRefOf(b.p), localAccount("makerB").address, b.marks.monad), 60_000, 300);
    console.log(`  Maker B filled a new transfer meanwhile: ${bFill.txHash.slice(0, 12)}`);
    console.log(`  waiting: fill window (${d.hub.fillWindow}s) -> CRE coverage -> Watchtower proof -> slash`);
    let last = "";
    const slashed = await waitFor(
      "watchtower slash",
      async () => {
        const r = (await fetch(`http://127.0.0.1:3713/watched?srcRef=0x${srcRefOf(p).toString(16).padStart(64, "0")}`).then((x) => x.json())) as any[];
        const row = r.find((x) => x.maker === localAccount("makerA").address.toLowerCase());
        const line = row ? `${row.status}: ${row.note ?? ""}` : "";
        if (line && line !== last) console.log(`  · ${line}`);
        last = line;
        return row?.status === "slashed" ? row : null;
      },
      180_000,
      2000,
    );
    const delta = (await bal(monad, usdcMonad, user.address)) - before;
    const ok = delta === gross + BigInt(bFill.amount);
    results.push({ scenario: "B dead Maker slashed (ZK)", pass: ok, detail: `sender +${formatUnits(delta, 6)} USDC on Monad = gross ${formatUnits(gross, 6)} from Maker A's margin + Maker B's ${formatUnits(bFill.amount, 6)} fill; proof ${slashed.proofMs} ms` });
  } catch (e) {
    results.push({ scenario: "B dead Maker slashed (ZK)", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- C
  try {
    say("C · mistyped ident code 9999 -> refund on the source chain");
    const usdcSep = CHAINS.sepolia.usdc.address;
    const before = await bal(sepolia, usdcSep, user.address);
    const { p, gross, marks } = await pay(localAccount("makerB").address, parseUnits("3", 6), 9999);
    const refund = await waitFor("refund", () => findPayout(sepolia, d.chains[CHAINS.sepolia.chainId]!.payoutRouter, srcRefOf(p), localAccount("makerB").address, marks.sepolia), 60_000, 500);
    const lost = before - (await bal(sepolia, usdcSep, user.address));
    results.push({ scenario: "C bad code refunded", pass: refund.kind === 3 && lost <= parseUnits("0.04", 6), detail: `sent ${formatUnits(gross, 6)}, refunded ${formatUnits(refund.amount, 6)} USDC on Sepolia (cost ${formatUnits(lost, 6)} = refund fee + code dust)` });
  } catch (e) {
    results.push({ scenario: "C bad code refunded", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- D
  try {
    say("D · native ETH Sepolia -> Base Sepolia");
    const base = publicClient("baseSepolia", "local");
    const before = await base.getBalance({ address: user.address });
    const { p, gross, marks } = await pay(localAccount("makerB").address, parseUnits("0.01", 18), undefined, true);
    const fill = await waitFor("eth fill", () => findPayout(base, d.chains[CHAINS.baseSepolia.chainId]!.payoutRouter, srcRefOf(p), localAccount("makerB").address, marks.base), 60_000, 500);
    const after = await base.getBalance({ address: user.address });
    results.push({ scenario: "D native ETH Sepolia->Base", pass: after - before === fill.amount, detail: `sent ${formatUnits(gross, 18)} ETH (code ${gross % 10_000n} in the wei), received ${formatUnits(fill.amount, 18)} ETH on Base Sepolia` });
  } catch (e) {
    results.push({ scenario: "D native ETH Sepolia->Base", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- E
  if (hasArbitrum) try {
    say("E · 5 USDC Arbitrum Sepolia -> Monad");
    const quotes = await k.quote({ srcChainId: CHAINS.arbitrumSepolia.chainId, dstChainId: CHAINS.monadTestnet.chainId, token: "USDC", amount: parseUnits("5", 6), makerUrls });
    // Maker A is offline since B: the quote comes from Maker B
    const best = quotes.find((q) => q.quotable);
    if (!best) throw new Error(`no quotable Maker: ${JSON.stringify(quotes.map((q) => q.reason))}`);
    const before = await bal(monad, usdcMonad, user.address);
    const { p, gross, mark } = await payRoute("arbitrumSepolia", "monadTestnet", best.maker, parseUnits("5", 6), false);
    await waitFor("fill", () => findPayout(monad, d.chains[CHAINS.monadTestnet.chainId]!.payoutRouter, srcRefOf(p), best.maker, mark), 60_000, 300);
    const got = (await bal(monad, usdcMonad, user.address)) - before;
    results.push({ scenario: "E fill USDC Arbitrum->Monad", pass: got === BigInt(best.net), detail: `sent ${formatUnits(gross, 6)} USDC (code ${gross % 10_000n}), received ${formatUnits(got, 6)} USDC on Monad` });
  } catch (e) {
    results.push({ scenario: "E fill USDC Arbitrum->Monad", pass: false, detail: (e as Error).message });
  }

  // ---------------------------------------------------------------- F
  if (hasOp) try {
    say("F · native ETH Sepolia -> OP Sepolia");
    const maker = localAccount("makerB").address;
    const op = publicClient("opSepolia", "local");
    const before = await op.getBalance({ address: user.address });
    const { p, gross, mark } = await payRoute("sepolia", "opSepolia", maker, parseUnits("0.01", 18), true);
    const fill = await waitFor("eth fill", () => findPayout(op, d.chains[CHAINS.opSepolia.chainId]!.payoutRouter, srcRefOf(p), maker, mark), 60_000, 500);
    const after = await op.getBalance({ address: user.address });
    results.push({ scenario: "F native ETH Sepolia->OP", pass: after - before === fill.amount, detail: `sent ${formatUnits(gross, 18)} ETH (code ${gross % 10_000n} in the wei), received ${formatUnits(fill.amount, 18)} ETH on OP Sepolia` });
  } catch (e) {
    results.push({ scenario: "F native ETH Sepolia->OP", pass: false, detail: (e as Error).message });
  }

  say(`Kakushi demo (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const r of results) console.log(`${r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.scenario.padEnd(30)} ${r.detail}`);
  console.log("\nCRE attestation: local runner (CRE workflow logic + Chainlink MockKeystoneForwarder), not a DON. Logs: .stack/*.log");
}

function cleanup() {
  if (keepSuccessfulStack) return;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  if (ownsStack) { try { stack("down"); } catch {} }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { keepSuccessfulStack = false; cleanup(); process.exit(130); });

main()
  .then(() => {
    keepSuccessfulStack = args.has("--keep") && results.length === expected && results.every((r) => r.pass);
    cleanup();
    process.exit(results.length === expected && results.every((r) => r.pass) ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    cleanup();
    process.exit(1);
  });
