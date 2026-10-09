"use client";

import { useMemo } from "react";
import { createWalletClient, http, parseAbi, type Hex, type PublicClient } from "viem";
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

export const factoryAbi = parseAbi([
  "function createPool(address token, uint256 denomination) returns (address pool)",
  "function allPools() view returns (address[])",
]);
const poolViewAbi = parseAbi(["function token() view returns (address)", "function denomination() view returns (uint256)"]);
const erc20MetaAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

export interface PoolInfo {
  address: Hex;
  token: Hex;
  symbol: string;
  decimals: number;
  denomination: string;
  /** created by anyone through the factory (not in the curated deployment list) */
  community?: boolean;
}

/** Curated pools plus every pool anyone opened through the factory on this chain. */
export async function loadPools(client: PublicClient, pc: PrivacyChain): Promise<PoolInfo[]> {
  const curated: PoolInfo[] = Object.values(pc.privacy.pools).map((p) => ({ ...p }));
  const factory = (pc.privacy as { poolFactory?: Hex }).poolFactory;
  if (!factory) return curated;
  const addrs = (await client.readContract({ address: factory, abi: factoryAbi, functionName: "allPools" })) as Hex[];
  const known = new Set(curated.map((p) => p.address.toLowerCase()));
  const extra = await Promise.all(
    addrs.filter((a) => !known.has(a.toLowerCase())).map(async (address): Promise<PoolInfo> => {
      const [token, denomination] = await Promise.all([
        client.readContract({ address, abi: poolViewAbi, functionName: "token" }) as Promise<Hex>,
        client.readContract({ address, abi: poolViewAbi, functionName: "denomination" }) as Promise<bigint>,
      ]);
      const native = /^0x0{40}$/i.test(token);
      const [symbol, decimals] = native
        ? [chainById(pc.chain.chainId).nativeSymbol, chainById(pc.chain.chainId).nativeDecimals]
        : await Promise.all([client.readContract({ address: token, abi: erc20MetaAbi, functionName: "symbol" }) as Promise<string>, client.readContract({ address: token, abi: erc20MetaAbi, functionName: "decimals" }).then(Number)]);
      return { address, token, symbol, decimals, denomination: denomination.toString(), community: true };
    }),
  );
  return [...curated, ...extra];
}
