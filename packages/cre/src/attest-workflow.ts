/**
 * kakushi-attest-<chain>: Chainlink CRE is Kakushi's destination-state attester.
 *
 * Each cron run, for ONE chain (one workflow instance per chain keeps every run inside CRE's
 * 15-EVM-reads quota):
 *   1. hub reads: EBC.allMakers(), AttestationOracle.lastPayoutToBlock(chain)
 *   2. the chain's safe head (finalized tag on Monad; latest - confirmations elsewhere,
 *      DEMO ASSUMPTION: 3 confirmations on Sepolia/Base Sepolia instead of finality)
 *   3. the next contiguous block range (<= 100 blocks, CRE's log-query limit)
 *   4. filterLogs: PayoutRouter.Payout + SourceRouter.PaymentEncoded, and USDC Transfer(to = Maker)
 *   5. one header per block holding a log (timestamps), the window shrunk to fit the quota
 *   6. normalize -> sorted Poseidon2 trees (packages/attest-core, the same code the circuits'
 *      witnesses and the local runner use) -> report = abi.encode(Window[])
 *   7. writeReport to AttestationOracle.onReport on the Monad hub
 *
 * The oracle only accepts block-contiguous PAYOUT windows; a failed write leaves its cursor
 * untouched, so the next run retries the same range (idempotent).
 */
import { type CronPayload, cre, type Runtime } from "@chainlink/cre-sdk";
import { buildChainWindows, capByDistinctBlocks, encodeReport, nextRange, type RawLog, windowLogFilters } from "@kakushi/attest-core";
import type { Hex } from "viem";
import { ebcAbi, oracleAbi } from "./abi.ts";
import { type AttestConfig, attestConfigSchema } from "./config.ts";
import { evmClientFor, filterLogs, header, ReadBudget, readContract, writeReport } from "./evm.ts";

export { attestConfigSchema as configSchema };

export interface AttestResult {
  chainId: number;
  status: "written" | "up-to-date";
  fromBlock?: string;
  toBlock?: string;
  payoutRoot?: string;
  sourceLeaves?: number;
  payoutLeaves?: number;
  txHash?: string;
  reads: number;
}

export function onCron(runtime: Runtime<AttestConfig>, _payload?: CronPayload): string {
  const cfg = runtime.config;
  const budget = new ReadBudget();
  const hub = evmClientFor(cfg.hub.chainSelectorName);
  const evm = cfg.chain.chainSelectorName === cfg.hub.chainSelectorName ? hub : evmClientFor(cfg.chain.chainSelectorName);

  const makers = readContract(runtime, hub, budget, { address: cfg.hub.ebc as Hex, abi: ebcAbi, functionName: "allMakers" }) as Hex[];
  const lastTo = readContract(runtime, hub, budget, {
    address: cfg.hub.oracle as Hex,
    abi: oracleAbi,
    functionName: "lastPayoutToBlock",
    args: [BigInt(cfg.chain.chainId)],
  }) as bigint;

  const head = header(runtime, evm, budget, cfg.chain.head === "finalized" ? "finalized" : "latest");
  const safeHead = cfg.chain.head === "finalized" ? head.number : head.number - BigInt(cfg.chain.confirmations);
  const range = nextRange(lastTo, BigInt(cfg.chain.startBlock), safeHead, BigInt(cfg.chain.maxBlocks));
  if (!range) {
    return JSON.stringify({ chainId: cfg.chain.chainId, status: "up-to-date", reads: budget.used } satisfies AttestResult);
  }

  const chainCfg = {
    chainId: cfg.chain.chainId,
    payoutRouter: cfg.chain.payoutRouter as Hex,
    sourceRouter: cfg.chain.sourceRouter as Hex,
    tokens: cfg.chain.tokens as Hex[],
    makers,
  };
  let logs: RawLog[] = [];
  for (const f of windowLogFilters(chainCfg)) {
    logs = logs.concat(filterLogs(runtime, evm, budget, { addresses: f.address, topics: f.topics, fromBlock: range.from, toBlock: range.to }));
  }
  // headers: from, to, and each block with a log; keep 1 read spare for safety
  const capped = capByDistinctBlocks(logs, range.from, range.to, Math.max(0, budget.left - 3));
  const times = new Map<bigint, bigint>();
  const fromH = header(runtime, evm, budget, range.from);
  times.set(fromH.number, fromH.timestamp);
  const toH = capped.to === range.from ? fromH : header(runtime, evm, budget, capped.to);
  times.set(toH.number, toH.timestamp);
  for (const b of capped.blocks) {
    if (!times.has(b)) times.set(b, header(runtime, evm, budget, b).timestamp);
  }
  const built = buildChainWindows({
    cfg: chainCfg,
    from: range.from,
    to: capped.to,
    fromTime: fromH.timestamp,
    toTime: toH.timestamp,
    logs: capped.logs,
    blockTime: (n) => {
      const t = times.get(n);
      if (t === undefined) throw new Error(`missing timestamp for block ${n}`);
      return t;
    },
  });
  const windows = built.source ? [built.source.window, built.payout.window] : [built.payout.window];
  const txHash = writeReport(runtime, hub, cfg.hub.oracle as Hex, encodeReport(windows), cfg.gasLimit);
  const result: AttestResult = {
    chainId: cfg.chain.chainId,
    status: "written",
    fromBlock: range.from.toString(),
    toBlock: capped.to.toString(),
    payoutRoot: `0x${built.payout.window.root.toString(16)}`,
    sourceLeaves: built.source?.window.leafCount ?? 0,
    payoutLeaves: built.payout.window.leafCount,
    txHash,
    reads: budget.used,
  };
  runtime.log(`kakushi-attest ${JSON.stringify(result)}`);
  return JSON.stringify(result);
}

export const initWorkflow = (config: AttestConfig) => [
  cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron),
];
