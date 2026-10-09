// The single chain registry. Adding a chain to Kakushi = one entry here + an IChainAdapter
// instance (packages/adapters). Every other package reads chains from this file.

export type ChainKey = "monadTestnet" | "sepolia" | "baseSepolia";
export type Network = "local" | "testnet";

export interface ChainConfig {
  key: ChainKey;
  chainId: number;
  name: string;
  shortName: string;
  vmKind: "evm";
  /** ident code that routes a payment TO this chain (last 4 digits of the amount) */
  identCode: number;
  nativeSymbol: string;
  nativeDecimals: number;
  /** public testnet endpoints (override with env, see rpcUrl()) */
  publicRpc: string;
  publicWs?: string;
  /** local anvil fork port (scripts/stack.sh) */
  localPort: number;
  explorer: string;
  usdc: { address: `0x${string}`; decimals: number };
  /** "monad" = use commit states / the finalized tag; "confirmations" = N blocks */
  finality: "monad" | "confirmations";
  /** blocks a Maker waits before filling (Monad: finalized tag) */
  makerConfirmations: number;
  /** blocks the attester waits before committing a window. DEMO ASSUMPTION for Sepolia /
   *  Base Sepolia: 3 confirmations instead of `finalized` (~13 min on Sepolia). */
  attestConfirmations: number;
  /** Chainlink CRE chain selector name */
  creChainName: string;
  blockTimeMs: number;
  isHub: boolean;
  envPrefix: string;
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  monadTestnet: {
    key: "monadTestnet",
    chainId: 10143,
    name: "Monad Testnet",
    shortName: "Monad",
    vmKind: "evm",
    identCode: 9001,
    nativeSymbol: "MON",
    nativeDecimals: 18,
    publicRpc: "https://testnet-rpc.monad.xyz",
    publicWs: "wss://testnet-rpc.monad.xyz",
    localPort: 18710,
    explorer: "https://testnet.monadvision.com",
    usdc: { address: "0x534b2f3A21130d7a60830c2Df862319e593943A3", decimals: 6 },
    finality: "monad",
    makerConfirmations: 0,
    attestConfirmations: 0,
    creChainName: "monad-testnet",
    // Monad testnet blocks are 300 ms since v0.15.0 (viem still says 400 ms)
    blockTimeMs: 300,
    isHub: true,
    envPrefix: "MONAD_TESTNET",
  },
  sepolia: {
    key: "sepolia",
    chainId: 11155111,
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    vmKind: "evm",
    identCode: 9002,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    publicRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    publicWs: "wss://ethereum-sepolia-rpc.publicnode.com",
    localPort: 18711,
    explorer: "https://sepolia.etherscan.io",
    usdc: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
    finality: "confirmations",
    makerConfirmations: 1,
    attestConfirmations: 3,
    creChainName: "ethereum-testnet-sepolia",
    blockTimeMs: 12000,
    isHub: false,
    envPrefix: "SEPOLIA",
  },
  baseSepolia: {
    key: "baseSepolia",
    chainId: 84532,
    name: "Base Sepolia",
    shortName: "Base Sepolia",
    vmKind: "evm",
    identCode: 9003,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    publicRpc: "https://sepolia.base.org",
    publicWs: undefined,
    localPort: 18712,
    explorer: "https://sepolia.basescan.org",
    usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
    finality: "confirmations",
    makerConfirmations: 1,
    attestConfirmations: 3,
    creChainName: "ethereum-testnet-sepolia-base-1",
    blockTimeMs: 2000,
    isHub: false,
    envPrefix: "BASE_SEPOLIA",
  },
};

/** Cleanverse compliant lane: payouts of CVA (aUSDC) on Monad, gated by CVI. */
export const COMPLIANT_LANE = {
  identCode: 9101,
  chainKey: "monadTestnet" as ChainKey,
  aUsdc: "0xFA96de5b8f434c26fdff953303dd66ff80af1026" as `0x${string}`,
  validator: "0xaC7e5179C2C7f03f209136886c172eb34F161792" as `0x${string}`,
};

/** Chainlink ETH/USD on Monad testnet (8 dp, 24 h heartbeat), prices ETH-lane margin. */
export const ETH_USD_FEED_MONAD_TESTNET = "0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31" as const;

/** Chainlink CRE forwarders on Monad testnet. */
export const CRE_FORWARDERS = {
  /** `cre workflow simulate --broadcast` (no DON signature check) */
  simulation: "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as const,
  /** production KeystoneForwarder (verifies DON signatures) */
  production: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482" as const,
};

/** CreateX: same router address on every chain. */
export const CREATEX = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed" as const;

export const PROTOCOL = {
  /** seconds; demo values (production: 1200 / 3600 / 60) */
  fillWindow: Number(envOr("KAKUSHI_FILL_WINDOW", "20")),
  disputeWindow: Number(envOr("KAKUSHI_DISPUTE_WINDOW", "120")),
  clockSkew: Number(envOr("KAKUSHI_CLOCK_SKEW", "10")),
  /** max seconds between a block and its attestation, used in the withdraw delay */
  attestLagMax: 60,
  paramDelay: Number(envOr("KAKUSHI_PARAM_DELAY", "60")),
  disputeBondWei: 50_000_000_000_000_000n, // 0.05 MON
  challengerRewardBps: 100,
  marginFactorBps: 11_000, // k = 1.1
  priceHaircutBps: 2_000,
  compensationPremiumBps: 1_000,
  maxPriceAgeSec: 26 * 3600,
  maxWindows: 8,
  treeDepth: 12,
  codeMod: 10_000n,
};

function envOr(name: string, fallback: string): string {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.length > 0 ? v : fallback;
}

export const CHAIN_LIST: ChainConfig[] = Object.values(CHAINS);
export const HUB: ChainConfig = CHAINS.monadTestnet;

export function chainById(chainId: number): ChainConfig {
  const c = CHAIN_LIST.find((x) => x.chainId === chainId);
  if (!c) throw new Error(`unknown chain id ${chainId}`);
  return c;
}

export function chainByIdentCode(code: number): ChainConfig | undefined {
  return CHAIN_LIST.find((x) => x.identCode === code);
}

export function currentNetwork(): Network {
  const v = typeof process !== "undefined" ? process.env?.KAKUSHI_NETWORK : undefined;
  if (v && v !== "local" && v !== "testnet") throw new Error("KAKUSHI_NETWORK must be local or testnet");
  return v === "testnet" ? "testnet" : "local";
}

/** Overrides on a local network must remain loopback. Public dev keys never
 * inherit a public RPC override from the operator's shell. */
function endpointOverride(value: string | undefined, network: Network): string | undefined {
  if (!value || network !== "local") return value;
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local network RPC overrides must use loopback");
  return value;
}
/** RPC for a chain: env `<PREFIX>_RPC_URL`, else local anvil or public. */
export function rpcUrl(c: ChainConfig, network: Network = currentNetwork()): string {
  const env = typeof process !== "undefined" ? process.env?.[`${c.envPrefix}_RPC_URL`] : undefined;
  if (env) return endpointOverride(env, network)!;
  return network === "local" ? `http://127.0.0.1:${c.localPort}` : c.publicRpc;
}

export function wsUrl(c: ChainConfig, network: Network = currentNetwork()): string | undefined {
  const env = typeof process !== "undefined" ? process.env?.[`${c.envPrefix}_WS_URL`] : undefined;
  if (env) return endpointOverride(env, network)!;
  return network === "local" ? `ws://127.0.0.1:${c.localPort}` : c.publicWs;
}

export function explorerTx(c: ChainConfig, hash: string, network: Network = currentNetwork()): string | undefined {
  return network === "local" ? undefined : `${c.explorer}/tx/${hash}`;
}
