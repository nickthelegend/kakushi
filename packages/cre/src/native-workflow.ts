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
import { checkNative, type NativeFacts, packFacts, parseRequest, unpackFacts, utf8ToBase64 } from "./native-checks.ts";

export { checkNative, packFacts, parseRequest, unpackFacts, utf8ToBase64 };

export { nativeConfigSchema as configSchema };

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
