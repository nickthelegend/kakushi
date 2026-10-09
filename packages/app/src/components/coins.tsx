import { Coin } from "@kakushi/ui";

/** Chain and asset coins in the ref-E coin style. */
export function ChainCoin({ chainId, size = 42 }: { chainId: number; size?: number }) {
  if (chainId === 10143) return <Coin tone="purple" size={size} label="Monad">M</Coin>;
  if (chainId === 84532) return <Coin tone="blue" size={size} label="Base Sepolia">B</Coin>;
  return <Coin tone="dark" size={size} label="Sepolia">Ξ</Coin>;
}

export function AssetCoin({ asset, size = 42 }: { asset: "USDC" | "ETH"; size?: number }) {
  return asset === "USDC" ? <Coin tone="blue" size={size} label="USDC">$</Coin> : <Coin tone="teal" size={size} label="ETH">Ξ</Coin>;
}
