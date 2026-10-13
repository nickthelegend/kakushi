// Local CRE runner. LABEL: this is NOT a Chainlink DON.
//
// `cre workflow simulate` needs `cre login` (a browser login only the user can do). Until then
// this runner executes the SAME attestation logic as the kakushi-attest / kakushi-source-native
// workflows (packages/attest-core: identical leaf normalization, windows, sorted Poseidon2
// roots and report encoding) and delivers each report through Chainlink's MockKeystoneForwarder
// that the Monad fork clones from Monad testnet (0xB9F7...D192): the same contract path
// `cre workflow simulate --broadcast` uses. Once logged in, run
// `pnpm --filter @kakushi/cre simulate:attest local-settings` instead.
//
//   node local/runner.ts            # loop every KAKUSHI_ATTEST_INTERVAL seconds (default 8)
//   KAKUSHI_ATTEST_MAX_BLOCKS       blocks per payout window (default 100, CRE's limit; larger = fewer hub txs)
//   KAKUSHI_ATTEST_IDLE_SECONDS     attest a range without Kakushi logs only once it is this old (default 0)
//   KAKUSHI_ATTEST_MIN_BALANCE_WEI  stop delivering below this MON balance (default 0)
//   KAKUSHI_ATTEST_HOST (default 127.0.0.1), CRE_ETH_PRIVATE_KEY (required off the local forks)
//   POST http://127.0.0.1:3714/attest-native {"chainId":11155111,"txHash":"0x..."}
//   GET  http://127.0.0.1:3714/status
import { createServer } from "node:http";
import { type Hex, keccak256, toHex, decodeEventLog, encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, CRE_FORWARDERS, chainById, currentNetwork, deployedChains } from "@kakushi/config";
import { loadDeployments } from "@kakushi/config/deployments";
import {
  buildChainWindows,
  capByDistinctBlocks,
  encodeReport,
  nativeSourceWindow,
  nextRange,
  rawReport,
  type RawLog,
  windowLogFilters,
  type AttestWindow,
} from "@kakushi/attest-core";
import { publicClient, walletClient, forwarderAbi, attestationOracleAbi, ebcAbi } from "@kakushi/sdk";
import { checkNative } from "../src/native-checks.ts";

const network = currentNetwork();
const d = loadDeployments(network);
const chains = deployedChains(d); // spokes without a deployment record are not attested
const INTERVAL = Number(process.env.KAKUSHI_ATTEST_INTERVAL ?? "8") * 1000;
const PORT = Number(process.env.KAKUSHI_ATTEST_PORT ?? "3714");
const MAX_BLOCKS = 100n; // CRE's log-query limit
const READ_BUDGET = 15; // CRE's EVM reads per execution
// Payout windows must be block-contiguous, and each one is a hub transaction. On Monad (~2.5 blocks/s)
// one 100-block window per tx costs ~15 MON an hour, so off the local forks the runner may cover a
// longer span per window (KAKUSHI_ATTEST_MAX_BLOCKS), paging eth_getLogs 100 blocks at a time. With
// the default 100 it keeps the CRE workflow's exact limits.
const SPAN = BigInt(process.env.KAKUSHI_ATTEST_MAX_BLOCKS ?? "100");
const PAGE_CONCURRENCY = Number(process.env.KAKUSHI_ATTEST_PAGE_CONCURRENCY ?? "4"); // public RPCs rate-limit bursts
const BLOCK_BUDGET = SPAN > MAX_BLOCKS ? 200 : READ_BUDGET; // distinct log blocks whose timestamps are read
// A range with no Kakushi logs is attested only once it is this old (seconds); 0 = every tick.
// Activity is attested on the next tick either way.
const IDLE_SECONDS = BigInt(process.env.KAKUSHI_ATTEST_IDLE_SECONDS ?? "0");
// stop delivering below this balance (wei of MON) and say so in /status, instead of failing every tick
const MIN_BALANCE = BigInt(process.env.KAKUSHI_ATTEST_MIN_BALANCE_WEI ?? "0");
// LOCAL ANVIL ONLY key (anvil account 5); on testnet set CRE_ETH_PRIVATE_KEY
if (network !== "local" && !process.env.CRE_ETH_PRIVATE_KEY) throw new Error(`CRE_ETH_PRIVATE_KEY must be set on ${network}`);
const KEY = (process.env.CRE_ETH_PRIVATE_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba") as Hex;
const account = privateKeyToAccount(KEY);
const hub = publicClient("monadTestnet");
const hubWallet = walletClient("monadTestnet", account);
const forwarder = (d.hub.creForwarder ?? CRE_FORWARDERS.simulation) as Hex;
// As in CRE, the workflow owner (pinned in the oracle) and the transmitter that pays the gas are
// separate: reports name the oracle's expected owner, while this runner's key only sends them.
const pinnedOwner = (await hub.readContract({ address: d.hub.attestationOracle, abi: parseAbi(["function expectedOwner() view returns (address)"]), functionName: "expectedOwner" }).catch(() => zeroAddress)) as Hex;
const workflowOwner = pinnedOwner !== zeroAddress ? pinnedOwner : account.address;

const status: Record<number, { lastTo?: string; lastRoot?: string; lastAt?: number; error?: string; windows: number }> = {};
for (const c of chains) status[c.chainId] = { windows: 0 };

async function deliver(windows: AttestWindow[], label: string): Promise<Hex> {
  const body = encodeReport(windows);
  const workflowName = toHex(new TextEncoder().encode(keccak256(toHex(label)).slice(2, 12)));
  const raw = rawReport({
    body,
    workflowId: keccak256(toHex(`kakushi-local:${label}`)),
    workflowName,
    workflowOwner,
    executionId: keccak256(toHex(`${label}:${Date.now()}:${Math.random()}`)),
    timestamp: Math.floor(Date.now() / 1000),
  });
  const before = (await hub.readContract({ address: d.hub.attestationOracle, abi: attestationOracleAbi, functionName: "windowCount" })) as bigint;
  const data = encodeFunctionData({ abi: forwarderAbi, functionName: "report", args: [d.hub.attestationOracle, raw, "0x", []] });
  const gas = ((await hub.estimateGas({ account, to: forwarder, data })) * 115n) / 100n;
  const hash = await hubWallet.sendTransaction({
    chain: hubWallet.chain,
    account,
    to: forwarder,
    data,
    gas, // Monad charges the gas LIMIT: estimate + 15%
  });
  if (process.env.KAKUSHI_ATTEST_VERBOSE) console.log(`[attest] ${label}: ${windows.length} window(s), gas limit ${gas}, tx ${hash}`);
  const rc = await hub.waitForTransactionReceipt({ hash });
  // the mock forwarder swallows receiver reverts: check ReportProcessed.result and the count
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== forwarder.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: forwarderAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "ReportProcessed" && !(ev.args as { result: boolean }).result) throw new Error("oracle refused the report");
    } catch (e) {
      if ((e as Error).message === "oracle refused the report") throw e;
    }
  }
  const after = (await hub.readContract({ address: d.hub.attestationOracle, abi: attestationOracleAbi, functionName: "windowCount" })) as bigint;
  if (after !== before + BigInt(windows.length)) throw new Error(`oracle stored ${after - before} of ${windows.length} windows`);
  return hash;
}

async function attestChain(chainId: number): Promise<void> {
  const c = chainById(chainId);
  const dep = d.chains[chainId];
  if (!dep) throw new Error(`${c.name} is not in this deployment`);
  const client = publicClient(c.key);
  let reads = 0;
  const makers = (await hub.readContract({ address: d.hub.ebc, abi: ebcAbi, functionName: "allMakers" })) as Hex[];
  const lastTo = (await hub.readContract({ address: d.hub.attestationOracle, abi: attestationOracleAbi, functionName: "lastPayoutToBlock", args: [BigInt(chainId)] })) as bigint;
  reads += 2;
  const head = await client.getBlockNumber();
  reads += 1;
  const conf = network === "local" ? 0n : BigInt(c.attestConfirmations);
  const range = nextRange(lastTo, BigInt(dep.deployBlock), head - conf, SPAN);
  if (!range) return;
  const cfg = { chainId, payoutRouter: dep.payoutRouter, sourceRouter: dep.sourceRouter, tokens: [c.usdc.address], makers };
  let logs: RawLog[] = [];
  // RPCs cap eth_getLogs at ~100 blocks: page the span, a few chunks at a time
  const chunks: { from: bigint; to: bigint }[] = [];
  for (let b = range.from; b <= range.to; b += MAX_BLOCKS) chunks.push({ from: b, to: b + MAX_BLOCKS - 1n < range.to ? b + MAX_BLOCKS - 1n : range.to });
  for (const f of windowLogFilters(cfg)) {
    for (let i = 0; i < chunks.length; i += PAGE_CONCURRENCY) {
      const pages = await Promise.all(
        chunks.slice(i, i + PAGE_CONCURRENCY).map((ch) => {
          reads += 1;
          return client.request({
            method: "eth_getLogs",
            params: [{ address: f.address, topics: f.topics as never, fromBlock: `0x${ch.from.toString(16)}`, toBlock: `0x${ch.to.toString(16)}` }],
          }) as Promise<any[]>;
        }),
      );
      for (const res of pages) {
        logs = logs.concat(
          res.filter((l) => !l.removed).map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), transactionHash: l.transactionHash, logIndex: Number(BigInt(l.logIndex)) })),
        );
      }
    }
  }
  if (logs.length === 0 && IDLE_SECONDS > 0n) {
    const fromTime = (await client.getBlock({ blockNumber: range.from })).timestamp;
    if (BigInt(Math.floor(Date.now() / 1000)) - fromTime < IDLE_SECONDS) return;
  }
  if (MIN_BALANCE > 0n && (await hub.getBalance({ address: account.address })) < MIN_BALANCE) {
    throw new Error(`attester ${account.address} is below ${MIN_BALANCE} wei of MON: not delivering`);
  }
  const capped = capByDistinctBlocks(logs, range.from, range.to, SPAN > MAX_BLOCKS ? BLOCK_BUDGET : Math.max(0, READ_BUDGET - reads - 3));
  const times = new Map<bigint, bigint>();
  for (const b of [range.from, capped.to, ...capped.blocks]) {
    if (!times.has(b)) times.set(b, (await client.getBlock({ blockNumber: b })).timestamp);
  }
  const built = buildChainWindows({ cfg, from: range.from, to: capped.to, fromTime: times.get(range.from)!, toTime: times.get(capped.to)!, logs: capped.logs, blockTime: (n) => times.get(n)! });
  const windows = built.source ? [built.source.window, built.payout.window] : [built.payout.window];
  const tx = await deliver(windows, `kakushi-attest-${c.key}`);
  const s = status[chainId]!;
  s.lastTo = capped.to.toString();
  s.lastRoot = `0x${built.payout.window.root.toString(16)}`;
  s.lastAt = Date.now();
  s.windows += windows.length;
  s.error = undefined;
  if (process.env.KAKUSHI_ATTEST_VERBOSE) {
    console.log(`[attest] ${c.shortName} blocks ${range.from}-${capped.to} source=${built.source?.window.leafCount ?? 0} payout=${built.payout.window.leafCount} tx=${tx}`);
  }
}

export async function attestNative(chainId: number, txHash: Hex): Promise<{ root: string; tx: Hex }> {
  const c = chainById(chainId);
  if (!d.chains[chainId]) throw new Error(`${c.name} is not in this deployment`);
  const client = publicClient(c.key);
  const [tx, rc, head] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash }), client.getBlockNumber()]);
  const blk = await client.getBlock({ blockNumber: rc.blockNumber });
  const makers = (await hub.readContract({ address: d.hub.ebc, abi: ebcAbi, functionName: "allMakers" })) as Hex[];
  const facts = { from: tx.from, to: (tx.to ?? "0x0000000000000000000000000000000000000000") as Hex, value: tx.value, input: tx.input, status: rc.status === "success" ? 1 : 0, blockNumber: rc.blockNumber, timestamp: blk.timestamp, head };
  const refusal = checkNative(facts, makers, network === "local" ? 0 : c.attestConfirmations);
  if (refusal) throw new Error(`refused: ${refusal}`);
  const w = nativeSourceWindow({ chainId, txHash, from: facts.from, to: facts.to, value: facts.value, blockNumber: facts.blockNumber, timestamp: facts.timestamp });
  const hash = await deliver([w.window], "kakushi-source-native");
  return { root: `0x${w.window.root.toString(16)}`, tx: hash };
}

let busy = false;
async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (const c of chains) {
      try {
        await attestChain(c.chainId);
      } catch (e) {
        // viem keeps the RPC's own reason in `details` (rate limit, range cap…): keep it visible
        const err = e as Error & { details?: string };
        status[c.chainId]!.error = [err.message.split("\n")[0], err.details].filter(Boolean).join(": ").slice(0, 300);
        console.error(`[attest] ${c.shortName}: ${status[c.chainId]!.error}`);
      }
    }
  } finally {
    busy = false;
  }
}

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-headers", "content-type");
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && req.url === "/status") {
      res.end(JSON.stringify({ runner: "local (CRE logic, MockKeystoneForwarder); not a DON", network, forwarder, intervalMs: INTERVAL, chains: status }));
      return;
    }
    if (req.method === "POST" && req.url === "/attest-native") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const j = JSON.parse(body) as { chainId: number; txHash: Hex };
      res.end(JSON.stringify(await attestNative(Number(j.chainId), j.txHash)));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}).listen(PORT, process.env.KAKUSHI_ATTEST_HOST ?? "127.0.0.1", () => {
  console.log(`[attest] local CRE runner on :${PORT}, every ${INTERVAL / 1000}s, forwarder ${forwarder} (${CHAINS.monadTestnet.shortName} hub)`);
});

void tick();
setInterval(() => void tick(), INTERVAL);
