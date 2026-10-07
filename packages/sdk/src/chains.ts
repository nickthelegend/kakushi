import { defineChain, type Chain } from "viem";
import { CHAINS, type ChainConfig, type ChainKey, type Network, rpcUrl, currentNetwork } from "@kakushi/config";

/** viem chain for a Kakushi chain on a network (local forks keep the real chain ids). */
export function viemChain(c: ChainConfig, network: Network = currentNetwork(), rpc?: string): Chain {
  const url = rpc ?? rpcUrl(c, network);
  return defineChain({
    id: c.chainId,
    name: network === "local" ? `${c.name} (local fork)` : c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: c.nativeDecimals },
    rpcUrls: { default: { http: [url] } },
    blockExplorers: network === "local" ? undefined : { default: { name: "explorer", url: c.explorer } },
    // Monad: 300 ms blocks (viem's built-in definition still says 400 ms)
    blockTime: c.blockTimeMs,
  });
}

export function chainKeyOf(chainId: number): ChainKey {
  const k = (Object.keys(CHAINS) as ChainKey[]).find((key) => CHAINS[key].chainId === chainId);
  if (!k) throw new Error(`unknown chain ${chainId}`);
  return k;
}
