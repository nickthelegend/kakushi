// Kakushi Watchtower: the permissionless Challenger.
//   WATCHTOWER_KEY=0x... WATCHTOWER_PORT=3713 node src/main.ts
// For every payment to any registered Maker it waits for the fill deadline; if no compliant
// payout appears, it waits for Chainlink CRE attestation to cover the deadline, builds the
// PaymentCompliance proof from the attested windows, opens a dispute (posting the MON bond)
// and proves it: the Maker's margin goes to the sender, the bond comes back plus a 1% reward.
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { type Hex, encodeFunctionData, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_LIST, CHAINS, chainById } from "@kakushi/config";
import { toHex32 } from "@kakushi/attest-core";
import { prove } from "@kakushi/attest-core/prover";
import { EvmAdapter, type IncomingPayment } from "@kakushi/adapters";
import { blockBefore, disputeModuleAbi, errText, findPayout, findSourcePayments, prepareDispute, type SourcePayment } from "@kakushi/sdk";
import { kakushiFromDisk } from "@kakushi/sdk/node";

const k = kakushiFromDisk();
const key = process.env.WATCHTOWER_KEY as Hex | undefined;
if (!key) throw new Error("WATCHTOWER_KEY is not set");
const account = privateKeyToAccount(key);
const port = Number(process.env.WATCHTOWER_PORT ?? "3713");
const attesterUrl = process.env.KAKUSHI_ATTESTER_URL ?? "http://127.0.0.1:3714";
const dbPath = process.env.WATCHTOWER_DB ?? `.data/watchtower-${k.network}.sqlite`;
mkdirSync(".data", { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS watched (
  srcRef TEXT NOT NULL, maker TEXT NOT NULL, srcChainId INTEGER NOT NULL, txHash TEXT NOT NULL, logIndex INTEGER NOT NULL,
  sender TEXT NOT NULL, token TEXT NOT NULL, gross TEXT NOT NULL, recipient TEXT NOT NULL, blockNumber TEXT NOT NULL,
  timestamp INTEGER NOT NULL, via TEXT NOT NULL, status TEXT NOT NULL, note TEXT, disputeKey TEXT, openTx TEXT, proveTx TEXT,
  proofMs INTEGER, updatedAt INTEGER NOT NULL, PRIMARY KEY (srcRef, maker));
  CREATE TABLE IF NOT EXISTS cursors (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);

const log = (m: string) => console.log(`[watchtower] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const adapters = Object.fromEntries(CHAIN_LIST.map((c) => [c.chainId, new EvmAdapter(k, c.key)]));

type Row = { srcRef: string; maker: string; srcChainId: number; txHash: string; logIndex: number; sender: string; token: string; gross: string; recipient: string; blockNumber: string; timestamp: number; via: string; status: string; note: string | null; disputeKey: string | null; openTx: string | null; proveTx: string | null; proofMs: number | null; updatedAt: number };

function upsert(p: SourcePayment, status: string, note?: string) {
  db.prepare(
    `INSERT INTO watched (srcRef, maker, srcChainId, txHash, logIndex, sender, token, gross, recipient, blockNumber, timestamp, via, status, note, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(srcRef, maker) DO NOTHING`,
  ).run(toHex32(BigInt(srcRefOf(p))), p.maker.toLowerCase(), p.srcChainId, p.txHash, p.logIndex, p.sender, p.token, p.gross.toString(), p.recipient, p.blockNumber.toString(), Number(p.timestamp), p.via, status, note ?? null, Date.now());
}
function setRow(srcRef: string, maker: string, f: Partial<Row>) {
  const cols = Object.keys(f);
  if (cols.length === 0) return;
  db.prepare(`UPDATE watched SET ${cols.map((c) => `${c} = ?`).join(", ")}, updatedAt = ? WHERE srcRef = ? AND maker = ?`).run(...(cols.map((c) => (f as Record<string, never>)[c]) as never[]), Date.now(), srcRef, maker.toLowerCase());
}
import { computeSrcRef } from "@kakushi/attest-core";
const srcRefOf = (p: Pick<SourcePayment, "srcChainId" | "txHash" | "logIndex">) => computeSrcRef(p.srcChainId, p.txHash, p.logIndex);
const toPayment = (r: Row): SourcePayment => ({ srcChainId: r.srcChainId, txHash: r.txHash as Hex, logIndex: r.logIndex, sender: r.sender as Hex, maker: r.maker as Hex, token: r.token as Hex, gross: BigInt(r.gross), recipient: r.recipient as Hex, blockNumber: BigInt(r.blockNumber), timestamp: BigInt(r.timestamp), via: r.via as SourcePayment["via"] });

/** Watch payments to every Maker on every chain. */
async function watchChain(chainId: number) {
  const a = adapters[chainId]!;
  const ck = `cursor:${chainId}`;
  const saved = db.prepare(`SELECT v FROM cursors WHERE k = ?`).get(ck) as { v: string } | undefined;
  let cursor = saved ? BigInt(saved.v) : undefined;
  for (;;) {
    try {
      const head = await a.safeHead();
      if (cursor === undefined) cursor = head + 1n;
      if (head >= cursor) {
        const to = head - cursor > 100n ? cursor + 100n : head;
        for (const m of await k.makers()) {
          for (const p of await a.paymentsIn(m, cursor, to)) onPayment(p);
        }
        cursor = to + 1n;
        db.prepare(`INSERT INTO cursors (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(ck, cursor.toString());
        continue;
      }
    } catch (e) {
      log(`${chainById(chainId).shortName}: ${(e as Error).message.split("\n")[0]}`);
    }
    await sleep(CHAINS[a.key].finality === "monad" ? 500 : 1500);
  }
}

function onPayment(p: IncomingPayment) {
  upsert({ ...p, srcChainId: p.chainId }, "watching");
}

/** Drive each watched payment: paid? -> done. Unpaid past deadline -> attest, prove, dispute. */
async function drive(r: Row) {
  const p = toPayment(r);
  const c = await k.classify(p.maker, p.srcChainId, p.token, p.gross, p.timestamp);
  if (c.kind === 0) return setRow(r.srcRef, r.maker, { status: "no-obligation" });
  const deadline = p.timestamp + k.fillWindow;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const router = k.d.chains[c.obligationChainId]!.payoutRouter;
  const oblClient = k.clientById(c.obligationChainId);
  const fromBlock = await blockBefore(oblClient, p.timestamp - k.clockSkew, chainById(c.obligationChainId).blockTimeMs);
  const paid = await findPayout(oblClient, router, BigInt(r.srcRef), p.maker, fromBlock);
  if (paid && paid.timestamp <= deadline && paid.amount >= c.expected && paid.recipient.toLowerCase() === (c.kind === 1 ? p.recipient : p.sender).toLowerCase()) {
    return setRow(r.srcRef, r.maker, { status: "paid", note: `${c.kind === 1 ? "filled" : "refunded"} ${paid.txHash}` });
  }
  if (now <= deadline) return; // still within the fill window
  if (r.status === "watching") setRow(r.srcRef, r.maker, { status: "overdue", note: "no compliant payout by the deadline" });

  // native source payments are attested on demand (kakushi-source-native)
  if (p.token === zeroAddress && r.note !== "native-attested") {
    try {
      const res = await fetch(`${attesterUrl}/attest-native`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: p.srcChainId, txHash: p.txHash }) });
      if (res.ok) setRow(r.srcRef, r.maker, { note: "native-attested" });
    } catch {}
  }
  const plan = await prepareDispute(k, p);
  if (!plan.ready) return setRow(r.srcRef, r.maker, { status: "overdue", note: plan.reason });
  setRow(r.srcRef, r.maker, { status: "proving", note: `${plan.payoutWindowIds.length} attested windows` });
  let proof;
  try {
    proof = await prove("payment_compliance", plan.inputs);
  } catch (e) {
    return setRow(r.srcRef, r.maker, { status: "unprovable", note: `witness unsatisfiable: the Maker paid compliantly (${(e as Error).message.slice(0, 80)})` });
  }
  const hub = k.hub;
  const dm = k.d.hub.disputeModule;
  const send = async (data: Hex, value = 0n) => {
    const gas = ((await hub.estimateGas({ account, to: dm, data, value })) * 12n) / 10n;
    const w = (await import("@kakushi/sdk")).walletClient("monadTestnet", account, k.network);
    const hash = await w.sendTransaction({ chain: w.chain, account, to: dm, data, value, gas });
    const rc = await hub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`tx reverted ${hash}`);
    return hash;
  };
  const dkey = (await hub.readContract({ address: dm, abi: disputeModuleAbi, functionName: "disputeKeyOf", args: [r.srcRef as Hex, p.maker] })) as Hex;
  const d = await k.dispute(dkey);
  let openTx = r.openTx;
  if (d.settled) return setRow(r.srcRef, r.maker, { status: d.status === 3 ? "slashed" : "maker-proven", disputeKey: dkey });
  if (d.status !== 1) {
    openTx = await send(encodeFunctionData({ abi: disputeModuleAbi, functionName: "openDispute", args: [BigInt(p.srcChainId), p.txHash, p.logIndex, p.maker] }), k.bond);
    setRow(r.srcRef, r.maker, { status: "disputed", disputeKey: dkey, openTx });
    log(`opened dispute ${dkey.slice(0, 10)} against ${p.maker.slice(0, 8)} (${openTx})`);
  }
  const proveTx = await send(encodeFunctionData({ abi: disputeModuleAbi, functionName: "proveDispute", args: [plan.claim as never, plan.payoutWindowIds, proof.proof] }));
  setRow(r.srcRef, r.maker, { status: "slashed", disputeKey: dkey, openTx, proveTx, proofMs: proof.ms, note: `margin slashed to ${p.sender}` });
  log(`slashed ${p.maker.slice(0, 8)} for ${r.srcRef.slice(0, 10)}: sender ${p.sender.slice(0, 8)} compensated (proof ${proof.ms} ms, ${proveTx})`);
}

async function driveLoop() {
  const busy = new Set<string>();
  for (;;) {
    const rows = db.prepare(`SELECT * FROM watched WHERE status IN ('watching', 'overdue', 'disputed', 'proving')`).all() as unknown as Row[];
    for (const r of rows) {
      const id = `${r.srcRef}:${r.maker}`;
      if (busy.has(id)) continue;
      busy.add(id);
      drive(r)
        .catch((e) => { const m = errText(e); log(`drive ${r.srcRef.slice(0, 10)}: ${m}`); setRow(r.srcRef, r.maker, { note: m.slice(0, 300) }); })
        .finally(() => busy.delete(id));
    }
    await sleep(2000);
  }
}

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("content-type", "application/json");
  if (req.method === "OPTIONS") return void res.end();
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const stats = db.prepare(`SELECT status, COUNT(*) AS n FROM watched GROUP BY status`).all();
      return void res.end(JSON.stringify({ ok: true, challenger: account.address, bond: k.bond.toString(), stats }));
    }
    if (req.method === "GET" && url.pathname === "/watched") {
      const srcRef = url.searchParams.get("srcRef");
      const rows = srcRef ? db.prepare(`SELECT * FROM watched WHERE srcRef = ?`).all(srcRef) : db.prepare(`SELECT * FROM watched ORDER BY updatedAt DESC LIMIT 100`).all();
      return void res.end(JSON.stringify(rows));
    }
    // a sender asks the Watchtower to protect a specific payment
    if (req.method === "POST" && url.pathname === "/watch") {
      let body = "";
      for await (const ch of req) body += ch;
      const j = JSON.parse(body) as { chainId: number; txHash: Hex };
      const payments = await findSourcePayments(k, Number(j.chainId), j.txHash);
      if (!payments.length) {
        res.statusCode = 404;
        return void res.end(JSON.stringify({ error: "not a Kakushi payment to a registered Maker" }));
      }
      for (const payment of payments) upsert(payment, "watching");
      const srcRefs = payments.map(payment => toHex32(srcRefOf(payment)));
      return void res.end(JSON.stringify({ watching: true, srcRef: srcRefs[0], srcRefs }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message.split("\n")[0] }));
  }
}).listen(port, "127.0.0.1", () => log(`challenger ${account.address} on :${port} (${k.network}); attester ${attesterUrl}`));

for (const c of CHAIN_LIST) void watchChain(c.chainId);
void driveLoop();
