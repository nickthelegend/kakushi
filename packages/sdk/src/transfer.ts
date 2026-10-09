// Building the encoded transfer, recognizing a source payment, and watching its payout.
import { type Hex, type PublicClient, decodeEventLog, encodeFunctionData, zeroAddress } from "viem";
import { chainById } from "@kakushi/config";
import { computeSrcRef, NATIVE_LOG_INDEX, TOPIC_PAYOUT, toHex32 } from "@kakushi/attest-core";
import { erc20Abi, sourceRouterAbi, payoutRouterAbi } from "./abi.ts";
import type { Kakushi } from "./kakushi.ts";
import type { SourcePayment } from "./types.ts";

export interface TxRequest {
  to: Hex;
  data?: Hex;
  value?: bigint;
  /** ERC-20 approval needed first (SourceRouter path only) */
  approve?: { token: Hex; spender: Hex; amount: bigint };
}

/**
 * The payment transaction. Raw path (default): a plain transfer of `gross` straight to the
 * Maker's EOA; the destination is the last 4 digits of the amount and the recipient is the
 * sender's own address on the destination chain. Custom recipient: SourceRouter.pay.
 */
export function buildTransferTx(k: Kakushi, a: { srcChainId: number; token: Hex; maker: Hex; gross: bigint; sender: Hex; recipient?: Hex }): TxRequest {
  const custom = a.recipient && a.recipient.toLowerCase() !== a.sender.toLowerCase();
  if (!custom) {
    if (a.token === zeroAddress) return { to: a.maker, value: a.gross };
    return { to: a.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [a.maker, a.gross] }) };
  }
  const router = k.d.chains[a.srcChainId]!.sourceRouter;
  return {
    to: router,
    value: a.token === zeroAddress ? a.gross : 0n,
    data: encodeFunctionData({ abi: sourceRouterAbi, functionName: "pay", args: [a.maker, a.token, a.gross, a.recipient!] }),
    approve: a.token === zeroAddress ? undefined : { token: a.token, spender: router, amount: a.gross },
  };
}

/** All recognized source payments, retaining receipt log indices for distinct srcRefs. */
export async function findSourcePayments(k: Kakushi, srcChainId: number, txHash: Hex): Promise<SourcePayment[]> {
  const client = k.clientById(srcChainId);
  const [tx, rc] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  if (rc.status !== "success") return [];
  const blk = await client.getBlock({ blockNumber: rc.blockNumber });
  const makers = new Set((await k.makers()).map((m) => m.toLowerCase()));
  const router = k.d.chains[srcChainId]!.sourceRouter.toLowerCase();
  const usdc = chainById(srcChainId).usdc.address.toLowerCase();
  const payments: SourcePayment[] = [];
  for (const log of rc.logs) {
    if (log.removed) continue;
    if (log.address.toLowerCase() === router) {
      try {
        const ev = decodeEventLog({ abi: sourceRouterAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "PaymentEncoded" && makers.has((ev.args as any).maker.toLowerCase())) {
          const a = ev.args as any;
          payments.push({ srcChainId, txHash, logIndex: log.logIndex, sender: a.sender, maker: a.maker, token: a.token, gross: a.gross, recipient: a.recipient, blockNumber: rc.blockNumber, timestamp: blk.timestamp, via: "source-router" });
        }
      } catch {}
    }
    if (log.address.toLowerCase() === usdc) {
      try {
        const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        const a = ev.args as any;
        if (ev.eventName === "Transfer" && makers.has(a.to.toLowerCase()) && a.from.toLowerCase() !== router && !makers.has(a.from.toLowerCase())) {
          payments.push({ srcChainId, txHash, logIndex: log.logIndex, sender: a.from, maker: a.to, token: log.address, gross: a.value, recipient: a.from, blockNumber: rc.blockNumber, timestamp: blk.timestamp, via: "raw-erc20" });
        }
      } catch {}
    }
  }
  if (tx.to && makers.has(tx.to.toLowerCase()) && tx.input === "0x" && tx.value > 0n) {
    payments.push({ srcChainId, txHash, logIndex: NATIVE_LOG_INDEX, sender: tx.from, maker: tx.to, token: zeroAddress, gross: tx.value, recipient: tx.from, blockNumber: rc.blockNumber, timestamp: blk.timestamp, via: "raw-native" });
  }
  return payments;
}

/** Compatibility helper for single-payment flows; batch consumers use findSourcePayments. */
export async function findSourcePayment(k: Kakushi, srcChainId: number, txHash: Hex): Promise<SourcePayment | null> {
  return (await findSourcePayments(k, srcChainId, txHash))[0] ?? null;
}

export function srcRefOf(p: Pick<SourcePayment, "srcChainId" | "txHash" | "logIndex">): bigint {
  return computeSrcRef(p.srcChainId, p.txHash, p.logIndex);
}

export interface PayoutSeen {
  txHash: Hex;
  blockNumber: bigint;
  timestamp: bigint;
  recipient: Hex;
  token: Hex;
  amount: bigint;
  kind: 2 | 3;
}

/**
 * Look for the Maker's Payout for `srcRef` from `fromBlock`. Pages in 100-block chunks: Monad's
 * public RPC (and forks forwarding to it) refuse larger eth_getLogs ranges.
 */
export async function findPayout(client: PublicClient, router: Hex, srcRef: bigint, maker: Hex, fromBlock: bigint, chunk = 100n): Promise<PayoutSeen | null> {
  const head = await client.getBlockNumber();
  const event = payoutRouterAbi.find((x) => x.type === "event" && x.name === "Payout") as any;
  for (let from = fromBlock; from <= head; from += chunk) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    const logs = await client.getLogs({ address: router, event, args: { srcRef: toHex32(srcRef), maker }, fromBlock: from, toBlock: to });
    const l = logs[0] as any;
    if (!l) continue;
    const blk = await client.getBlock({ blockNumber: l.blockNumber });
    return { txHash: l.transactionHash, blockNumber: l.blockNumber, timestamp: blk.timestamp, recipient: l.args.recipient, token: l.args.token, amount: l.args.amount, kind: Number(l.args.kind) as 2 | 3 };
  }
  return null;
}

/** A block number at or before unix time `ts` (estimated from block time, with a safety margin). */
export async function blockBefore(client: PublicClient, ts: bigint, blockTimeMs: number): Promise<bigint> {
  const head = await client.getBlock();
  if (ts >= head.timestamp) return head.number!;
  const back = ((head.timestamp - ts) * 1000n) / BigInt(Math.max(blockTimeMs, 250));
  const est = head.number! - back - 20n;
  return est > 0n ? est : 0n;
}

export { TOPIC_PAYOUT };

/** One-line error text including the node's reason (viem `details`), for logs and UI. */
export function errText(e: unknown): string {
  const x = e as { shortMessage?: string; details?: string; message?: string; cause?: { details?: string; shortMessage?: string } };
  const base = x.shortMessage ?? x.message?.split("\n")[0] ?? String(e);
  const det = x.details ?? x.cause?.details ?? x.cause?.shortMessage;
  return det && !base.includes(det) ? `${base}: ${det}` : base;
}
