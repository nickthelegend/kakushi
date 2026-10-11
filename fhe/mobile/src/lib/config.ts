// Networks. `local` is the Monad-testnet fork the Kakushi stack runs on (anvil :18810, gateway :8890);
// `testnet` is Monad testnet (contracts not deployed there yet: DEPLOYMENTS.testnet is null).
import { DEPLOYMENTS, type Deployment } from "./deployments.ts";
import type { Hex } from "./bytes.ts";

export type NetworkId = "local" | "testnet";

export interface Network {
  id: NetworkId;
  label: string;
  chainId: number;
  rpcUrl: string;
  gatewayUrl: string;
  /** Envio HyperIndex GraphQL (Hasura) serving FeedItem; empty = scan logs on the device */
  indexerUrl: string;
  deployment: Deployment | null;
  /** Agora AUSD (6 dp, EIP-712 domain "Agora Dollar" v1, ERC-2612 + ERC-3009) */
  ausd: Hex;
  /** Agora's testnet faucet: requestFunds(address) -> 10,000 AUSD, 60 s global cooldown */
  faucet: Hex;
  /** how settlement is tracked: block tags on a fork, monadNewHeads commit states on Monad */
  settlement: "tags" | "monadHeads";
  /** DEV-only anvil accounts and a DEV gas sponsor are offered only here */
  dev: boolean;
  /** eth_getLogs block range per request */
  logRange: bigint;
  explorerTx?: (hash: string) => string;
}

// The iOS Simulator and Expo web reach the Mac's localhost directly. Android emulator: 10.0.2.2;
// a physical phone: the Mac's LAN IP (set EXPO_PUBLIC_LOCAL_HOST).
const LOCAL_HOST = process.env.EXPO_PUBLIC_LOCAL_HOST ?? "127.0.0.1";

export const AUSD: Hex = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const AUSD_FAUCET: Hex = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
export const MONAD_WS = "wss://testnet-rpc.monad.xyz";

export const NETWORKS: Record<NetworkId, Network> = {
  local: {
    id: "local",
    label: "Local fork",
    chainId: 10143,
    rpcUrl: process.env.EXPO_PUBLIC_LOCAL_RPC ?? `http://${LOCAL_HOST}:18810`,
    gatewayUrl: process.env.EXPO_PUBLIC_LOCAL_GATEWAY ?? `http://${LOCAL_HOST}:8890`,
    indexerUrl: process.env.EXPO_PUBLIC_LOCAL_INDEXER ?? `http://${LOCAL_HOST}:8892/v1/graphql`,
    deployment: DEPLOYMENTS.local,
    ausd: AUSD,
    faucet: AUSD_FAUCET,
    settlement: "tags",
    dev: true,
    logRange: 100n, // same as Monad (eth_getLogs <= 100 blocks), so the fork behaves like testnet
  },
  testnet: {
    id: "testnet",
    label: "Monad testnet",
    chainId: 10143,
    rpcUrl: process.env.EXPO_PUBLIC_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz",
    gatewayUrl: process.env.EXPO_PUBLIC_TESTNET_GATEWAY ?? "",
    indexerUrl: process.env.EXPO_PUBLIC_TESTNET_INDEXER ?? "", // the Envio Cloud endpoint once deployed
    deployment: DEPLOYMENTS.testnet,
    ausd: AUSD,
    faucet: AUSD_FAUCET,
    settlement: "monadHeads",
    dev: false,
    logRange: 100n,
    explorerTx: (h) => `https://testnet.monadexplorer.com/tx/${h}`,
  },
};

/** Public HTTPS host for pay links (https://<host>/claim#...). Same host as the passkey domain. */
export const LINK_HOST = process.env.EXPO_PUBLIC_LINK_HOST ?? "pay.kakushi.example";

/** How long an unlocked signing session lives before the key is zeroed and the passkey is asked again. */
export const SESSION_MINUTES = Number(process.env.EXPO_PUBLIC_SESSION_MINUTES ?? 5);
