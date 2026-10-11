// Local CRE runner. LABEL: this is NOT a Chainlink DON.
//
// `cre workflow simulate` needs `cre login` (a browser login only the user can do). Until then
// this runner executes the SAME relay logic as kakushi-fhe-decrypt-relay (src/core.ts: identical
// parsing, canonical form, handle check and report encoding) and delivers each report through
// Chainlink's MockKeystoneForwarder, which the Monad fork carries from Monad testnet
// (0xB9F7...D192): the same contract path `cre workflow simulate --broadcast` uses. The oracle
// verifies the k-of-n KMS signatures either way. Once logged in, run
// `pnpm --filter @kakushi/fhe-cre simulate local-settings` instead.
//
//   RPC_URL=http://127.0.0.1:18810 GATEWAY_URL=http://127.0.0.1:8890 node local/runner.ts
//   GET http://127.0.0.1:8891/status
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, type Hex, http, keccak256, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonical, DECRYPTION_REQUESTED, encodeReport, parseResult, requestIdFromTopics } from "../src/core.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const network = process.env.KAKUSHI_FHE_NETWORK ?? "local";
const dep = JSON.parse(readFileSync(process.env.KAKUSHI_FHE_DEPLOYMENT ?? `${ROOT}contracts/deployments/${network}.json`, "utf8"));
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:18810";
const GATEWAY = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8890").replace(/\/$/, "");
const PORT = Number(process.env.CRE_RUNNER_PORT ?? 8891);
const POLL = Number(process.env.CRE_POLL_MS ?? 500);
const FORWARDER = (dep.creForwarder ?? "0x0000000000000000000000000000000000000000") as Hex;
// LOCAL ANVIL ONLY key (anvil account 5); on testnet set CRE_ETH_PRIVATE_KEY
const KEY = (process.env.CRE_ETH_PRIVATE_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba") as Hex;
if (/^0x0+$/.test(FORWARDER)) throw new Error("deployment has no creForwarder: deploy with CRE_FORWARDER set");

const chain = defineChain({ id: Number(dep.chainId), name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ chain, account, transport: http(RPC) });

const oracleAbi = parseAbi([
  "function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)",
  "function handlesOf(uint256) view returns (bytes32[])",
]);
const forwarderAbi = parseAbi([
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

/** KeystoneForwarder metadata header + body (the layout the forwarder parses before onReport). */
function rawReport(body: Hex, label: string): Hex {
  const h = (x: string, bytes: number) => x.replace(/^0x/, "").padStart(bytes * 2, "0").slice(-bytes * 2);
  const header =
    "01" +
    h(keccak256(toHex(`${label}:${Date.now()}:${Math.random()}`)), 32) + // execution id
    h(Math.floor(Date.now() / 1000).toString(16), 4) +
    h("1", 4) + // DON id
    h("1", 4) + // DON config version
    h(keccak256(toHex("kakushi-fhe-local:kakushi-fhe-decrypt-relay")), 32) + // workflow id
    h(keccak256(toHex("kakushi-fhe-decrypt-relay")).slice(2, 22), 10) + // workflow name
    h(account.address, 20) + // workflow owner
    "0001"; // report id
  return `0x${header}${body.replace(/^0x/, "")}` as Hex;
}

const status = { delivered: 0, pending: 0, errors: 0, lastBlock: "0", last: [] as { requestId: string; tx?: string; ms?: number; error?: string }[] };
const seenAt = new Map<string, number>();
const open = new Set<bigint>();

async function relay(id: bigint): Promise<boolean> {
  const [, , fulfilled] = await pub.readContract({ address: dep.oracle, abi: oracleAbi, functionName: "requests", args: [id] });
  if (fulfilled) return true;
  const res = await fetch(`${GATEWAY}/decryptions/${id}`);
  if (res.status === 404) return false; // KMS has not signed it yet
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  const result = parseResult(await res.text(), id);
  canonical(result); // the DON's consensus input; identical across honest nodes
  const onchain = (await pub.readContract({ address: dep.oracle, abi: oracleAbi, functionName: "handlesOf", args: [id] })).map((h) => h.toLowerCase());
  if (onchain.join() !== result.handles.join()) throw new Error("handles differ from the on-chain request");

  const data = encodeFunctionData({ abi: forwarderAbi, functionName: "report", args: [dep.oracle, rawReport(encodeReport(result), id.toString()), "0x", []] });
  const est = await pub.estimateGas({ account, to: FORWARDER, data });
  // Monad charges the gas LIMIT: explicit and tight
  const hash = await wallet.sendTransaction({ chain, account, to: FORWARDER, data, gas: (est * 13n) / 10n });
  const rc = await pub.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  // the mock forwarder swallows receiver reverts: check ReportProcessed.result
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== FORWARDER.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: forwarderAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "ReportProcessed" && !ev.args.result) throw new Error("oracle refused the report");
    } catch (e) {
      if ((e as Error).message === "oracle refused the report") throw e;
    }
  }
  const [, , done] = await pub.readContract({ address: dep.oracle, abi: oracleAbi, functionName: "requests", args: [id] });
  if (!done) throw new Error("report written but the request is still open");
  const ms = Date.now() - (seenAt.get(id.toString()) ?? Date.now());
  status.delivered++;
  status.last = [{ requestId: id.toString(), tx: hash, ms }, ...status.last].slice(0, 20);
  console.log(`request ${id}: delivered through the forwarder in ${ms} ms (${hash})`);
  return true;
}

async function loop() {
  let cursor = BigInt(process.env.CRE_FROM_BLOCK ?? dep.deployBlock ?? 0);
  for (;;) {
    try {
      const head = await pub.getBlockNumber();
      while (cursor <= head) {
        const to = cursor + 99n > head ? head : cursor + 99n; // Monad: eth_getLogs <= 100 blocks
        const logs = await pub.getLogs({ address: dep.oracle, fromBlock: cursor, toBlock: to });
        for (const l of logs) {
          if (l.topics[0]?.toLowerCase() !== DECRYPTION_REQUESTED) continue;
          const id = requestIdFromTopics(l.topics as Hex[]);
          if (!seenAt.has(id.toString())) seenAt.set(id.toString(), Date.now());
          open.add(id);
        }
        cursor = to + 1n;
      }
      status.lastBlock = head.toString();
      // one sender account: deliver in order so transactions never race for the same nonce
      for (const id of [...open].sort((a, b) => (a < b ? -1 : 1))) {
        try {
          if (await relay(id)) open.delete(id);
        } catch (e) {
          status.errors++;
          status.last = [{ requestId: id.toString(), error: (e as Error).message.split("\n")[0] }, ...status.last].slice(0, 20);
          console.log(`request ${id}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      status.pending = open.size;
    } catch (e) {
      console.log(`poll: ${(e as Error).message.split("\n")[0]}`);
    }
    await new Promise((r) => setTimeout(r, POLL));
  }
}

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/status" || req.url === "/health") return res.end(JSON.stringify({ ok: true, label: "local CRE runner (NOT a Chainlink DON)", forwarder: FORWARDER, oracle: dep.oracle, ...status }));
  res.statusCode = 404;
  res.end("{}");
}).listen(PORT, () => console.log(`local CRE runner on :${PORT}, forwarder ${FORWARDER}, oracle ${dep.oracle}`));
loop();
