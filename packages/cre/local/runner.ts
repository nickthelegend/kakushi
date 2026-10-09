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
//   POST http://127.0.0.1:3714/attest-native {"chainId":11155111,"txHash":"0x..."}
//   GET  http://127.0.0.1:3714/status
import { createServer } from "node:http";
import { type Hex, keccak256, toHex, decodeEventLog, encodeFunctionData } from "viem";
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
// LOCAL ANVIL ONLY key (anvil account 5); on testnet set CRE_ETH_PRIVATE_KEY
const KEY = (process.env.CRE_ETH_PRIVATE_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba") as Hex;
const account = privateKeyToAccount(KEY);
const hub = publicClient("monadTestnet");
const hubWallet = walletClient("monadTestnet", account);
const forwarder = (d.hub.creForwarder ?? CRE_FORWARDERS.simulation) as Hex;

const status: Record<number, { lastTo?: string; lastRoot?: string; lastAt?: number; error?: string; windows: number }> = {};
for (const c of chains) status[c.chainId] = { windows: 0 };

async function deliver(windows: AttestWindow[], label: string): Promise<Hex> {
  const body = encodeReport(windows);
  const workflowName = toHex(new TextEncoder().encode(keccak256(toHex(label)).slice(2, 12)));
  const raw = rawReport({
    body,
    workflowId: keccak256(toHex(`kakushi-local:${label}`)),
    workflowName,
    workflowOwner: account.address,
    executionId: keccak256(toHex(`${label}:${Date.now()}:${Math.random()}`)),
    timestamp: Math.floor(Date.now() / 1000),
  });
  const before = (await hub.readContract({ address: d.hub.attestationOracle, abi: attestationOracleAbi, functionName: "windowCount" })) as bigint;
  const hash = await hubWallet.sendTransaction({
    chain: hubWallet.chain,
    account,
    to: forwarder,
    data: encodeFunctionData({ abi: forwarderAbi, functionName: "report", args: [d.hub.attestationOracle, raw, "0x", []] }),
    gas: 1_500_000n, // Monad charges the gas LIMIT: keep it explicit and tight
  });
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
  const range = nextRange(lastTo, BigInt(dep.deployBlock), head - conf, MAX_BLOCKS);
  if (!range) return;
  const cfg = { chainId, payoutRouter: dep.payoutRouter, sourceRouter: dep.sourceRouter, tokens: [c.usdc.address], makers };
  let logs: RawLog[] = [];
  for (const f of windowLogFilters(cfg)) {
    reads += 1;
    const res = (await client.request({
      method: "eth_getLogs",
      params: [{ address: f.address, topics: f.topics as never, fromBlock: `0x${range.from.toString(16)}`, toBlock: `0x${range.to.toString(16)}` }],
    })) as any[];
    logs = logs.concat(
      res.filter((l) => !l.removed).map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), transactionHash: l.transactionHash, logIndex: Number(BigInt(l.logIndex)) })),
    );
  }
  const capped = capByDistinctBlocks(logs, range.from, range.to, Math.max(0, READ_BUDGET - reads - 3));
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
        status[c.chainId]!.error = (e as Error).message.split("\n")[0];
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
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[attest] local CRE runner on :${PORT}, every ${INTERVAL / 1000}s, forwarder ${forwarder} (${CHAINS.monadTestnet.shortName} hub)`);
});

void tick();
setInterval(() => void tick(), INTERVAL);
