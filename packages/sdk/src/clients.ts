import { createPublicClient, createWalletClient, http, type Account, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, type ChainKey, type Network, currentNetwork, rpcUrl } from "@kakushi/config";
import { viemChain } from "./chains.ts";

const cache = new Map<string, PublicClient>();

export function publicClient(key: ChainKey, network: Network = currentNetwork(), rpc?: string): PublicClient {
  const c = CHAINS[key];
  const url = rpc ?? rpcUrl(c, network);
  const id = `${key}:${url}`;
  let pc = cache.get(id);
  if (!pc) {
    pc = createPublicClient({ chain: viemChain(c, network, url), transport: http(url, { retryCount: 3, retryDelay: 250 }) }) as PublicClient;
    cache.set(id, pc);
  }
  return pc;
}

export function walletClient(key: ChainKey, account: Account | Hex, network: Network = currentNetwork(), rpc?: string): WalletClient {
  const c = CHAINS[key];
  const url = rpc ?? rpcUrl(c, network);
  const acct = typeof account === "string" ? privateKeyToAccount(account) : account;
  return createWalletClient({ account: acct, chain: viemChain(c, network, url), transport: http(url) });
}
