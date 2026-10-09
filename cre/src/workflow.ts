/**
 * fhish-decrypt-relay: Chainlink CRE is Fhish's decryption delivery layer.
 *
 * A contract calls FHE.requestDecryption(handles, callback). The Fhish KMS (k-of-n) decrypts and
 * signs an EIP-712 DecryptionResult, then publishes it at GET {gateway}/decryptions/:id. This
 * workflow replaces the single relayer key that would otherwise push `fulfill`:
 *
 *   trigger  (a) EVM log trigger on FhishDecryptionOracle.DecryptionRequested, one run per request
 *            (b) cron sweep over the newest requests, which catches anything (a) missed
 *   reads    requests(id).fulfilled and handlesOf(id) on Monad (skip finished work, and refuse a
 *            result whose handles differ from the on-chain request)
 *   fetch    the signed result over the HTTP capability; every node returns a canonical string
 *            and the DON only proceeds on identical answers
 *   write    report = abi.encode(requestId, cleartexts, signatures) -> KeystoneForwarder ->
 *            FhishDecryptionOracle.onReport, which re-verifies the k-of-n KMS signatures and
 *            calls the requesting contract back
 *
 * CRE adds liveness (no relayer key to keep funded and online) without adding trust: a report
 * can only carry cleartexts the KMS threshold signed.
 */
import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  type CronPayload,
  encodeCallMsg,
  type HTTPSendRequester,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  logTriggerConfig,
  prepareReportRequest,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, type Hex, parseAbi, zeroAddress } from "viem";
import { z } from "zod";
import { canonical, DECRYPTION_REQUESTED, encodeReport, fromCanonical, isMarker, parseResult, PENDING, requestIdFromTopics, sweepIds } from "./core.ts";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const configSchema = z.object({
  /** six-field cron, seconds first (CRE's fastest is every 30 s) */
  schedule: z.string().min(1),
  chainSelectorName: z.string(),
  oracle: address,
  /** Fhish gateway base URL, e.g. https://gateway.fhish.xyz */
  gatewayUrl: z.string().url(),
  /** block the reads use; "finalized" on Monad testnet (~2 blocks behind latest) */
  readAt: z.enum(["finalized", "latest"]).default("finalized"),
  /** log trigger confidence */
  confidence: z.enum(["SAFE", "LATEST", "FINALIZED"]).default("FINALIZED"),
  /** cron sweep: how many of the newest requests to check, and how many reports to write */
  sweepMax: z.number().int().min(1).max(10).default(8),
  maxWrites: z.number().int().min(1).max(4).default(3),
  gasLimit: z.string().regex(/^\d+$/),
});
export type Config = z.infer<typeof configSchema>;

const oracleAbi = parseAbi([
  "function nextRequestId() view returns (uint256)",
  "function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)",
  "function handlesOf(uint256) view returns (bytes32[])",
]);

type EVMClient = InstanceType<typeof cre.capabilities.EVMClient>;

/** The fields of an EVM log the handler reads. */
interface TriggerLog {
  topics: Uint8Array[];
}

export interface RelayResult {
  requestId: string;
  status: "written" | "already-fulfilled" | "pending" | "error";
  txHash?: string;
  detail?: string;
}

function evmClient(name: string): EVMClient {
  const selectors = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS as Record<string, bigint>;
  const selector = selectors[name];
  if (selector === undefined) throw new Error(`CRE has no EVM capability for chain "${name}"`);
  return new cre.capabilities.EVMClient(selector);
}

function read(runtime: Runtime<Config>, evm: EVMClient, functionName: "nextRequestId" | "requests" | "handlesOf", args: readonly unknown[] = []): unknown {
  const data = encodeFunctionData({ abi: oracleAbi, functionName, args } as never);
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: runtime.config.oracle as Hex, data }),
      blockNumber: runtime.config.readAt === "finalized" ? LAST_FINALIZED_BLOCK_NUMBER : LATEST_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi: oracleAbi, functionName, data: bytesToHex(reply.data) } as never);
}

/** Node mode: fetch the KMS-signed result and reduce it to the canonical string. */
export function fetchResult(req: HTTPSendRequester, gatewayUrl: string, requestId: string): string {
  try {
    const res = req.sendRequest({ url: `${gatewayUrl.replace(/\/$/, "")}/decryptions/${requestId}`, method: "GET", timeout: "5s" }).result();
    if (res.statusCode === 404) return PENDING;
    if (res.statusCode !== 200) return `ERR:HTTP ${res.statusCode}`;
    return canonical(parseResult(new TextDecoder().decode(res.body), BigInt(requestId)));
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }
}

function relay(runtime: Runtime<Config>, evm: EVMClient, requestId: bigint, knownOpen = false): RelayResult {
  const id = requestId.toString();
  const cfg = runtime.config;
  if (!knownOpen) {
    const [, , fulfilled] = read(runtime, evm, "requests", [requestId]) as readonly [Hex, Hex, boolean, Hex];
    if (fulfilled) return { requestId: id, status: "already-fulfilled" };
  }
  const agreed = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, fetchResult, consensusIdenticalAggregation<string>().withDefault("ERR:no consensus"))(cfg.gatewayUrl, id)
    .result();
  if (agreed === PENDING) return { requestId: id, status: "pending" };
  if (isMarker(agreed)) return { requestId: id, status: "error", detail: agreed };
  const result = fromCanonical(agreed);
  const onchain = (read(runtime, evm, "handlesOf", [requestId]) as Hex[]).map((h) => h.toLowerCase());
  if (onchain.join() !== result.handles.join()) return { requestId: id, status: "error", detail: "handles differ from the on-chain request" };

  const report = runtime.report(prepareReportRequest(encodeReport(result))).result();
  const write = evm.writeReport(runtime, { receiver: cfg.oracle as Hex, report, gasConfig: { gasLimit: cfg.gasLimit } }).result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    return { requestId: id, status: "error", detail: `write ${TxStatus[write.txStatus] ?? write.txStatus} ${write.errorMessage ?? ""}`.trim() };
  }
  return { requestId: id, status: "written", txHash: bytesToHex(write.txHash ?? new Uint8Array(32)) };
}

export function onRequested(runtime: Runtime<Config>, log: TriggerLog): string {
  const evm = evmClient(runtime.config.chainSelectorName);
  const r = relay(runtime, evm, requestIdFromTopics(log.topics.map((t) => bytesToHex(t) as Hex)));
  runtime.log(`fhish-decrypt-relay ${JSON.stringify(r)}`);
  if (r.status === "error") throw new Error(r.detail);
  return JSON.stringify(r);
}

export function onSweep(runtime: Runtime<Config>, _payload?: CronPayload): string {
  const cfg = runtime.config;
  const evm = evmClient(cfg.chainSelectorName);
  const next = read(runtime, evm, "nextRequestId") as bigint;
  const out: RelayResult[] = [];
  let writes = 0;
  for (const id of sweepIds(next, cfg.sweepMax)) {
    if (writes >= cfg.maxWrites) break;
    const [, , fulfilled] = read(runtime, evm, "requests", [id]) as readonly [Hex, Hex, boolean, Hex];
    if (fulfilled) continue;
    const r = relay(runtime, evm, id, true);
    if (r.status === "written") writes++;
    out.push(r);
  }
  runtime.log(`fhish-decrypt-relay sweep ${JSON.stringify(out)}`);
  return JSON.stringify(out);
}

export const initWorkflow = (config: Config) => {
  const evm = evmClient(config.chainSelectorName);
  return [
    cre.handler(
      evm.logTrigger(logTriggerConfig({ addresses: [config.oracle as Hex], topics: [[DECRYPTION_REQUESTED]], confidence: config.confidence })),
      onRequested,
    ),
    cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onSweep),
  ];
};
