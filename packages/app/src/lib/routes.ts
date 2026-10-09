import { zeroAddress, type Hex } from "viem";
import { CHAINS, type ChainKey } from "@kakushi/config";

export interface Route {
  id: string;
  src: ChainKey;
  dst: ChainKey;
  asset: "USDC" | "ETH";
}

/** The live routes (PLAN.md D5): USDC Sepolia <-> Monad; native ETH Sepolia <-> Base Sepolia. */
export const ROUTES: Route[] = [
  { id: "usdc-sep-monad", src: "sepolia", dst: "monadTestnet", asset: "USDC" },
  { id: "usdc-monad-sep", src: "monadTestnet", dst: "sepolia", asset: "USDC" },
  { id: "eth-sep-base", src: "sepolia", dst: "baseSepolia", asset: "ETH" },
  { id: "eth-base-sep", src: "baseSepolia", dst: "sepolia", asset: "ETH" },
];

export function tokenOf(r: Route, side: "src" | "dst"): { address: Hex; decimals: number; symbol: string } {
  const c = CHAINS[side === "src" ? r.src : r.dst];
  return r.asset === "USDC" ? { address: c.usdc.address, decimals: 6, symbol: "USDC" } : { address: zeroAddress, decimals: 18, symbol: "ETH" };
}
