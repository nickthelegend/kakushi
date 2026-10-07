// Thin wrappers over the CRE EVM capability (SDK 1.22). Every call counts toward the
// 15-reads-per-execution quota; ReadBudget makes that explicit.
import {
  blockNumber,
  bytesToHex,
  cre,
  encodeCallMsg,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  protoBigIntToBigint,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk";
import { type Abi, decodeFunctionResult, encodeFunctionData, type Hex, zeroAddress } from "viem";
import type { RawLog } from "@kakushi/attest-core";

export type EVMClient = InstanceType<typeof cre.capabilities.EVMClient>;

export const READ_LIMIT = 15;

export class ReadBudget {
  used = 0;
  constructor(readonly limit = READ_LIMIT) {}
  take(n = 1): void {
    if (this.used + n > this.limit) throw new Error(`CRE read budget exceeded (${this.used + n}/${this.limit})`);
    this.used += n;
  }
  get left(): number {
    return this.limit - this.used;
  }
}

export function evmClientFor(chainSelectorName: string): EVMClient {
  const selectors = cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS as Record<string, bigint>;
  const selector = selectors[chainSelectorName];
  if (selector === undefined) throw new Error(`CRE has no EVM capability for chain "${chainSelectorName}"`);
  return new cre.capabilities.EVMClient(selector);
}

export function readContract(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  budget: ReadBudget,
  call: { address: Hex; abi: Abi; functionName: string; args?: readonly unknown[] },
): unknown {
  budget.take();
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] });
  const reply = evm
    .callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: call.address, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })
    .result();
  return decodeFunctionResult({ abi: call.abi, functionName: call.functionName, data: bytesToHex(reply.data) });
}

/** Header of `which`: "finalized", "latest", or a block number. */
export function header(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  budget: ReadBudget,
  which: "finalized" | "latest" | bigint,
): { number: bigint; timestamp: bigint } {
  budget.take();
  const req =
    which === "finalized" ? { blockNumber: LAST_FINALIZED_BLOCK_NUMBER } : which === "latest" ? {} : { blockNumber: blockNumber(which) };
  const h = evm.headerByNumber(runtime, req).result().header;
  if (!h?.blockNumber) throw new Error(`no header for ${String(which)}`);
  return { number: protoBigIntToBigint(h.blockNumber), timestamp: BigInt(h.timestamp) };
}

export function filterLogs(
  runtime: Runtime<unknown>,
  evm: EVMClient,
  budget: ReadBudget,
  q: { addresses: Hex[]; topics: (Hex[] | null)[]; fromBlock: bigint; toBlock: bigint },
): RawLog[] {
  budget.take();
  const reply = evm
    .filterLogs(runtime, {
      filterQuery: {
        addresses: q.addresses.map((a) => hexToBase64(a)),
        topics: q.topics.map((t) => ({ topic: (t ?? []).map((x) => hexToBase64(x)) })),
        fromBlock: blockNumber(q.fromBlock),
        toBlock: blockNumber(q.toBlock),
      },
    })
    .result();
  return reply.logs
    .filter((l) => !l.removed)
    .map((l) => ({
      address: bytesToHex(l.address) as Hex,
      topics: l.topics.map((t) => bytesToHex(t) as Hex),
      data: bytesToHex(l.data) as Hex,
      blockNumber: l.blockNumber ? protoBigIntToBigint(l.blockNumber) : 0n,
      transactionHash: bytesToHex(l.txHash) as Hex,
      logIndex: l.index,
    }));
}

/** Sign `body` with the DON and write it to `receiver` through the forwarder. */
export function writeReport(runtime: Runtime<unknown>, evm: EVMClient, receiver: Hex, body: Hex, gasLimit: string): Hex {
  const report = runtime.report(prepareReportRequest(body)).result();
  const write = evm.writeReport(runtime, { receiver, report, gasConfig: { gasLimit } }).result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report write failed: ${TxStatus[write.txStatus] ?? write.txStatus} ${write.errorMessage ?? ""}`.trim());
  }
  return bytesToHex(write.txHash ?? new Uint8Array(32)) as Hex;
}
