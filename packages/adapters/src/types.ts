import type { Hex } from "viem";
import type { Leaf } from "@kakushi/attest-core";

export type VmKind = "evm" | "solana" | "starknet";

export interface TxRequest {
  to: string;
  data?: string;
  value?: bigint;
}

/** A payment observed arriving at a Maker on a source chain. */
export interface IncomingPayment {
  chainId: number;
  txHash: Hex;
  logIndex: number;
  srcRef: bigint;
  sender: Hex;
  maker: Hex;
  token: Hex;
  gross: bigint;
  recipient: Hex;
  blockNumber: bigint;
  timestamp: bigint;
  via: "raw-erc20" | "raw-native" | "source-router";
  /** Monad commit state when seen via monadLogs ("Proposed" | "Voted" | "Finalized"), else "confirmed" */
  commitState: string;
}

export interface PayoutResult {
  txHash: Hex;
  /** ms from submission to a receipt (eth_sendRawTransactionSync where available) */
  executedMs: number;
  blockNumber: bigint;
}

/**
 * The per-VM boundary (PLAN.md §5, NEXUS spec). Adding a chain = a config entry
 * (config/chains.ts) + an adapter instance; nothing else changes.
 */
export interface IChainAdapter {
  readonly chainId: number;
  readonly vmKind: VmKind;
  /** blocks a Maker waits before treating a payment as final */
  readonly finalityBlocks: number;
  /** the payment a sender makes: amount carries the ident code in its last 4 digits */
  encodePayment(to: string, token: string, amount: bigint, identCode: number): TxRequest;
  /** stream of payments to `maker` (all supported tokens when `token` is undefined) */
  watchIncoming(maker: Hex, token?: Hex, opts?: { fromBlock?: bigint; signal?: AbortSignal; pollMs?: number }): AsyncIterable<IncomingPayment>;
  /** pay out through the chain's PayoutRouter */
  submitPayout(args: { to: Hex; token: Hex; amount: bigint; srcRef: bigint; kind: "fill" | "refund" }): Promise<PayoutResult>;
  /** the normalized source leaf the circuit needs for a payment tx */
  getProofInputs(txHash: Hex): Promise<Leaf | null>;
}
