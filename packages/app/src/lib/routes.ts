import { zeroAddress, type Hex } from "viem";
import { CHAINS, deployedChains, type ChainKey } from "@kakushi/config";

export interface Route {
  id: string;
  src: ChainKey;
  dst: ChainKey;
  asset: "USDC" | "ETH";
}

const ETH_SPOKES: ChainKey[] = ["sepolia", "baseSepolia", "arbitrumSepolia", "opSepolia"];
const SHORT: Record<ChainKey, string> = { monadTestnet: "monad", sepolia: "sep", baseSepolia: "base", arbitrumSepolia: "arb", opSepolia: "op" };

/** Every route (PLAN.md D5): USDC between Monad and each USDC spoke, both ways; native ETH
 *  between every pair of ETH spokes. A deployment may cover only some chains; see routesFor. */
export const ROUTES: Route[] = [
  ...(["sepolia", "arbitrumSepolia", "opSepolia"] as ChainKey[]).flatMap((c): Route[] => [
    { id: `usdc-${SHORT[c]}-monad`, src: c, dst: "monadTestnet", asset: "USDC" },
    { id: `usdc-monad-${SHORT[c]}`, src: "monadTestnet", dst: c, asset: "USDC" },
  ]),
  ...ETH_SPOKES.flatMap((s) => ETH_SPOKES.filter((d) => d !== s).map((d): Route => ({ id: `eth-${SHORT[s]}-${SHORT[d]}`, src: s, dst: d, asset: "ETH" }))),
];

/** The routes a deployment actually covers (both ends deployed); all routes when there is none. */
export function routesFor(deployments: { chains: Record<number, unknown> } | null | undefined): Route[] {
  if (!deployments?.chains) return ROUTES;
  const live = new Set(deployedChains(deployments).map((c) => c.key));
  const r = ROUTES.filter((x) => live.has(x.src) && live.has(x.dst));
  return r.length ? r : ROUTES;
}

export function tokenOf(r: Route, side: "src" | "dst"): { address: Hex; decimals: number; symbol: string } {
  const c = CHAINS[side === "src" ? r.src : r.dst];
  return r.asset === "USDC" ? { address: c.usdc.address, decimals: 6, symbol: "USDC" } : { address: zeroAddress, decimals: 18, symbol: "ETH" };
}
