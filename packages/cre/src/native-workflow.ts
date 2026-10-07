/**
 * kakushi-source-native: attest ONE native-asset transfer (raw ETH sent straight to a
 * Maker's EOA). Native transfers emit no log, so the cron attester cannot see them; the
 * Watchtower / Sender / Maker asks this HTTP-triggered workflow instead, with
 * { "chainId": 11155111, "txHash": "0x..." }.
 *
 * The CRE EVM capability's Transaction message has no `from`, so the facts are read through
 * the HTTP capability as JSON-RPC (eth_getTransactionByHash / eth_getTransactionReceipt /
 * eth_blockNumber / eth_getBlockByNumber) and agreed by consensus (identical answers).
 * The DON then checks: success status, plain transfer (empty calldata), value > 0, recipient
 * is a registered Maker, enough confirmations; and writes a single-leaf SOURCE window.
 */
import { consensusIdenticalAggregation, cre, type HTTPPayload, type HTTPSendRequester, type Runtime } from "@chainlink/cre-sdk";
import { encodeReport, nativeSourceWindow } from "@kakushi/attest-core";
import type { Hex } from "viem";
import { ebcAbi } from "./abi.ts";
import { type NativeConfig, nativeConfigSchema } from "./config.ts";
import { evmClientFor, ReadBudget, readContract, writeReport } from "./evm.ts";

export { nativeConfigSchema as configSchema };

export interface NativeRequest {
  chainId: number;
  txHash: Hex;
}

export interface NativeFacts {
  from: Hex;
  to: Hex;
  value: bigint;
  input: Hex;
  status: number;
  blockNumber: bigint;
  timestamp: bigint;
  head: bigint;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : B64[c & 63]!;
  }
  return out;
}

export function parseRequest(raw: Uint8Array | string): NativeRequest {
  const j = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as { chainId?: unknown; txHash?: unknown };
  const chainId = Number(j.chainId);
  const txHash = String(j.txHash ?? "");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("payload.chainId must be a positive integer");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("payload.txHash must be a 32-byte hex hash");
  return { chainId, txHash: txHash as Hex };
}

/** Pack facts deterministically so identical-consensus can compare them. */
export function packFacts(f: NativeFacts): string {
  return [f.from, f.to, f.value, f.input, f.status, f.blockNumber, f.timestamp, f.head].map(String).join("|").toLowerCase();
}

export function unpackFacts(s: string): NativeFacts {
  if (s.startsWith("ERR:")) throw new Error(s.slice(4));
  const [from, to, value, input, status, blockNumber, timestamp, head] = s.split("|");
  return {
    from: from as Hex,
    to: to as Hex,
    value: BigInt(value!),
    input: input as Hex,
    status: Number(status),
    blockNumber: BigInt(blockNumber!),
    timestamp: BigInt(timestamp!),
    head: BigInt(head!),
  };
}

/** Node mode: read the transaction through JSON-RPC. */
export function fetchFacts(req: HTTPSendRequester, url: string, txHash: Hex): string {
  const call = (method: string, params: unknown[]): any => {
    const res = req
      .sendRequest({
        url,
        method: "POST",
        body: utf8ToBase64(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })),
        multiHeaders: { "content-type": { values: ["application/json"] } },
        timeout: "10s",
      })
      .result();
    if (res.statusCode !== 200) throw new Error(`${method}: HTTP ${res.statusCode}`);
    const j = JSON.parse(new TextDecoder().decode(res.body)) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message ?? "rpc error"}`);
    return j.result;
  };
  try {
    const tx = call("eth_getTransactionByHash", [txHash]);
    if (!tx) return "ERR:transaction not found";
    const rc = call("eth_getTransactionReceipt", [txHash]);
    if (!rc) return "ERR:transaction not mined";
    const blk = call("eth_getBlockByNumber", [rc.blockNumber, false]);
    const head = call("eth_blockNumber", []);
    return packFacts({
      from: tx.from,
      to: tx.to ?? "0x0000000000000000000000000000000000000000",
      value: BigInt(tx.value),
      input: tx.input ?? "0x",
      status: Number(BigInt(rc.status)),
      blockNumber: BigInt(rc.blockNumber),
      timestamp: BigInt(blk.timestamp),
      head: BigInt(head),
    });
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }
}

/** The DON-side checks, pure so tests and the local runner share them. */
export function checkNative(f: NativeFacts, makers: Hex[], confirmations: number): string | null {
  if (f.status !== 1) return "transaction reverted";
  if (f.input !== "0x") return "not a plain native transfer (has calldata)";
  if (f.value === 0n) return "zero value";
  if (!makers.some((m) => m.toLowerCase() === f.to.toLowerCase())) return "recipient is not a registered Maker";
  if (f.head - f.blockNumber < BigInt(confirmations)) return "not enough confirmations yet";
  return null;
}

export function onHttpTrigger(runtime: Runtime<NativeConfig>, payload: HTTPPayload): string {
  const cfg = runtime.config;
  const req = parseRequest(payload.input);
  const url = cfg.rpcs[String(req.chainId)];
  if (!url) throw new Error(`no RPC configured for chain ${req.chainId}`);
  const packed = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, fetchFacts, consensusIdenticalAggregation<string>().withDefault("ERR:no consensus"))(url, req.txHash)
    .result();
  const facts = unpackFacts(packed);
  const hub = evmClientFor(cfg.hub.chainSelectorName);
  const makers = readContract(runtime, hub, new ReadBudget(), { address: cfg.hub.ebc as Hex, abi: ebcAbi, functionName: "allMakers" }) as Hex[];
  const refusal = checkNative(facts, makers, cfg.confirmations[String(req.chainId)] ?? 0);
  if (refusal) throw new Error(`refused: ${refusal}`);
  const w = nativeSourceWindow({ chainId: req.chainId, txHash: req.txHash, from: facts.from, to: facts.to, value: facts.value, blockNumber: facts.blockNumber, timestamp: facts.timestamp });
  const txHash = writeReport(runtime, hub, cfg.hub.oracle as Hex, encodeReport([w.window]), cfg.gasLimit);
  const out = { chainId: req.chainId, txHash: req.txHash, root: `0x${w.window.root.toString(16)}`, reportTx: txHash };
  runtime.log(`kakushi-source-native ${JSON.stringify(out)}`);
  return JSON.stringify(out);
}

export const initWorkflow = (config: NativeConfig) => [
  cre.handler(
    new cre.capabilities.HTTPCapability().trigger({
      authorizedKeys: config.authorizedKeys.map((publicKey) => ({ type: "KEY_TYPE_ECDSA_EVM" as const, publicKey })),
    }),
    onHttpTrigger,
  ),
];
