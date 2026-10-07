import type { Hex } from "viem";

export interface PairInfo {
  pairId: Hex;
  maker: Hex;
  srcChainId: number;
  srcToken: Hex;
  dstChainId: number;
  dstToken: Hex;
  identCode: number;
  withholdingFee: bigint;
  tradingFeeBps: bigint;
  minAmount: bigint;
  maxAmount: bigint;
  active: boolean;
  marginToken: Hex;
  priceFeed: Hex;
  srcDecimals: number;
}

/** GET /quote response of a Maker node (JSON, amounts as decimal strings). */
export interface MakerQuote {
  maker: Hex;
  name: string;
  pairId: Hex;
  srcChainId: number;
  dstChainId: number;
  srcToken: Hex;
  dstToken: Hex;
  identCode: number;
  gross: string;
  principal: string;
  withholdingFee: string;
  tradingFee: string;
  net: string;
  minAmount: string;
  maxAmount: string;
  inventory: string;
  quotable: boolean;
  reason?: string;
  etaMs: number;
  margin: string;
  marginRequired: string;
}

export interface SourcePayment {
  srcChainId: number;
  txHash: Hex;
  logIndex: number;
  sender: Hex;
  maker: Hex;
  token: Hex;
  gross: bigint;
  recipient: Hex;
  blockNumber: bigint;
  timestamp: bigint;
  via: "raw-erc20" | "raw-native" | "source-router";
}
