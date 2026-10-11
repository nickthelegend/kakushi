// Fhish coprocessor for Monad. Env:
//   FHISH_NETWORK=local|testnet  RPC_URL  ENGINE_URL (default http://127.0.0.1:8899)
//   GATEWAY_PORT (default 8890)  FHISH_DEPLOYMENT (path to contracts/deployments/<network>.json)
//   FHISH_SECRETS (path to signers json; default ../.secrets/signers.json)  DELIVER=direct|cre|both
//   MONAD_WS_URL (monadLogs speculative source; default on testnet)  DECRYPT_AT=finalized|latest (KMS signs only once the request block is finalized; default finalized)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executorEvents, oracleAbi } from "./abi.ts";
import { Engine } from "./engine.ts";
import { OpGraph, type ExecEvent } from "./graph.ts";
import { Kms } from "./kms.ts";
import { Metrics } from "./metrics.ts";
import { startGateway } from "./gateway.ts";
import { subscribeMonadLogs } from "./monadlogs.ts";

const network = process.env.FHISH_NETWORK ?? "local";
const rpc = process.env.RPC_URL ?? (network === "local" ? "http://127.0.0.1:18810" : "https://testnet-rpc.monad.xyz");
const dep = JSON.parse(readFileSync(process.env.FHISH_DEPLOYMENT ?? new URL(`../../contracts/deployments/${network}.json`, import.meta.url), "utf8"));
const secrets = JSON.parse(readFileSync(process.env.FHISH_SECRETS ?? new URL("../../.secrets/signers.json", import.meta.url), "utf8"));
const log = (m: string) => console.log(`[coprocessor] ${m}`);

const chain = defineChain({ id: Number(dep.chainId), name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 3 }) }) as PublicClient;
const relayerAccount = privateKeyToAccount(secrets.relayer.privateKey);
const relayer = createWalletClient({ chain, account: relayerAccount, transport: http(rpc) });
const engine = new Engine(process.env.ENGINE_URL ?? "http://127.0.0.1:8899");
const metrics = new Metrics();
const graph = new OpGraph(engine, metrics, Number(process.env.FHISH_CONCURRENCY ?? 4), log);
const kms = new Kms({
  client,
  relayer,
  oracle: dep.oracle,
  chainId: Number(dep.chainId),
  signers: secrets.kmsSigners.map((s: { privateKey: Hex }) => privateKeyToAccount(s.privateKey)),
  threshold: Number(process.env.KMS_THRESHOLD ?? 2),
  engine,
  graph,
  metrics,
  deliver: (process.env.DELIVER as "direct" | "cre" | "both") ?? "direct",
  decryptAt: (process.env.DECRYPT_AT as "finalized" | "latest") ?? "finalized",
  log,
});

startGateway({
  port: Number(process.env.GATEWAY_PORT ?? 8890),
  client,
  chainId: Number(dep.chainId),
  executor: dep.executor,
  acl: dep.acl,
  inputVerifier: dep.inputVerifier,
  inputSigners: secrets.inputSigners.map((s: { privateKey: Hex }) => privateKeyToAccount(s.privateKey)),
  inputThreshold: Number(process.env.INPUT_THRESHOLD ?? 2),
  engine,
  kms,
  metrics,
  log,
});

function toEvent(l: any): ExecEvent | null {
  const a = l.args;
  switch (l.eventName) {
    case "FheOp":
      return { kind: "op", op: Number(a.op), result: a.result, lhs: a.lhs, rhs: a.rhs, scalar: a.scalar };
    case "FheSelect":
      return { kind: "select", result: a.result, control: a.control, ifTrue: a.ifTrue, ifFalse: a.ifFalse };
    case "TrivialEncrypt":
      return { kind: "trivial", result: a.result, value: a.value, type: Number(a.toType) };
    case "VerifyInput":
      return { kind: "input", result: a.result, inputHandle: a.inputHandle };
    case "Rand":
      return { kind: "rand", result: a.result, seed: a.seed, upperBound: a.upperBound, type: Number(a.randType) };
    default:
      return null;
  }
}

const cursorFile = new URL(`../../.fhish/cursor-${network}.json`, import.meta.url);
mkdirSync(new URL("../../.fhish/", import.meta.url), { recursive: true });
let cursor = existsSync(cursorFile) ? BigInt(JSON.parse(readFileSync(cursorFile, "utf8")).next) : BigInt(dep.deployBlock);

/** Feed parsed executor/oracle logs to the op graph and the KMS (both dedupe, so sources may overlap). */
function handle(logs: any[]) {
  const seenAt = Date.now();
  for (const l of logs) {
    if (l.address.toLowerCase() === dep.executor.toLowerCase()) {
      const e = toEvent(l);
      if (e) graph.submit(e);
    } else if (l.eventName === "DecryptionRequested") {
      void kms.handleRequest(l.args.requestId, l.args.handles, seenAt, l.blockNumber);
    }
  }
}

async function poll() {
  const head = await client.getBlockNumber();
  while (cursor <= head) {
    const to = cursor + 99n > head ? head : cursor + 99n; // Monad RPC: <= 100 blocks per eth_getLogs
    const raw = await client.getLogs({ address: [dep.executor, dep.oracle], fromBlock: cursor, toBlock: to });
    const logs = parseEventLogs({ abi: [...executorEvents, ...oracleAbi], logs: raw }).sort((x, y) =>
      x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1,
    );
    handle(logs as any[]);
    if (logs.length) log(`blocks ${cursor}-${to}: ${logs.length} events`);
    cursor = to + 1n;
    writeFileSync(cursorFile, JSON.stringify({ next: cursor.toString() }));
  }
}

const h = await engine.health().catch(() => null);
if (!h) throw new Error("fhish-engine is not running (fhish-engine serve --dir .fhish)");
log(`network ${network} chain ${dep.chainId}, engine tfhe ${h.tfhe} on ${h.threads} threads, executor ${dep.executor}`);
// Monad: start FHE work from Proposed/Voted logs (MONAD_WS_URL, e.g. wss://testnet-rpc.monad.xyz)
const wsUrl = process.env.MONAD_WS_URL ?? (network === "testnet" ? "wss://testnet-rpc.monad.xyz" : "");
if (wsUrl) {
  subscribeMonadLogs(wsUrl, [dep.executor, dep.oracle], (l) => {
    metrics.inc("speculative_logs");
    handle(parseEventLogs({ abi: [...executorEvents, ...oracleAbi], logs: [l] }) as any[]);
  }, log);
}
for (;;) {
  try {
    await poll();
  } catch (e) {
    log(`poll: ${(e as Error).message.split("\n")[0]}`);
  }
  await new Promise((r) => setTimeout(r, Number(process.env.POLL_MS ?? 300)));
}
