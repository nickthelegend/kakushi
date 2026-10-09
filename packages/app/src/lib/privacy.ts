"use client";

import { useMemo } from "react";
import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_LIST, chainById, type ChainConfig } from "@kakushi/config";
import type { PrivacyDeployment } from "@kakushi/config/deployments";
import { useRuntime } from "./runtime";

/** StealthPay: one transaction pays a stealth address and announces it (ERC-5564). */
export const stealthPayAbi = parseAbi([
  "function sendNative(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes1 viewTag) payable",
  "function sendToken(uint256 schemeId, address stealthAddress, address token, uint256 amount, bytes ephemeralPubKey, bytes1 viewTag) payable",
]);

export interface PrivacyChain {
  chain: ChainConfig;
  privacy: PrivacyDeployment;
}

/** Chains whose deployment record has the privacy layer, Monad first. */
export function usePrivacyChains(): { chains: PrivacyChain[]; ready: boolean } {
  const { cfg } = useRuntime();
  const d = cfg?.deployments as { chains?: Record<number, { privacy?: PrivacyDeployment }> } | null | undefined;
  const chains = useMemo(
    () =>
      CHAIN_LIST.flatMap((c) => {
        const p = d?.chains?.[c.chainId]?.privacy;
        return p ? [{ chain: c, privacy: p }] : [];
      }).sort((a, b) => (a.chain.key === "monadTestnet" ? -1 : b.chain.key === "monadTestnet" ? 1 : 0)),
    [d],
  );
  return { chains, ready: Boolean(cfg) };
}

/** A wallet for a stealth address's private key, over the app's RPC proxy. Never leaves the tab. */
export function stealthWallet(privateKey: Hex, chainId: number, rpcUrl: string) {
  const c = chainById(chainId);
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: { id: c.chainId, name: c.shortName, nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: c.nativeDecimals }, rpcUrls: { default: { http: [rpcUrl] } } },
    transport: http(rpcUrl),
  });
}

export const nativeSymbol = (chainId: number) => chainById(chainId).nativeSymbol;

export const poolAbi = parseAbi([
  "function deposit(bytes32 commitment) payable",
  "function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund) payable",
]);
export const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"]);
