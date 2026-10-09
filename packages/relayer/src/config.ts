// Relayer configuration from the environment.
//   RELAYER_KEY     0x… private key the relayer signs withdrawals with (never logged)
//   RELAYER_PORT    HTTP port (default 3715)
//   RELAYER_HOST    bind address (default 127.0.0.1; put a reverse proxy in front)
//   RELAYER_POOLS   JSON array: [{"chainId":10143,"pool":"0x…","minFee":"1000000000000000","rpc":"https://…"?}]
//   RELAYER_CONFIG  alternatively, a JSON file {"pools":[…]} (RELAYER_POOLS wins if both are set)
// RPC defaults to @kakushi/config's rpcUrl() for the chain (KAKUSHI_NETWORK, <PREFIX>_RPC_URL).
import { readFileSync } from "node:fs";
import { type Hex, getAddress, isAddress } from "viem";
import { type LocalAccount, privateKeyToAccount } from "viem/accounts";

export interface PoolConfig {
  chainId: number;
  pool: Hex;
  /** minimum fee, in the pool asset's base units */
  minFee: bigint;
  /** RPC override for this chain */
  rpc?: string;
}

export interface RelayerConfig {
  port: number;
  host: string;
  account: LocalAccount;
  pools: PoolConfig[];
}

export function parsePools(raw: unknown): PoolConfig[] {
  const list = (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { pools?: unknown }).pools : raw) as unknown;
  if (!Array.isArray(list) || list.length === 0) throw new Error("relayer needs at least one pool (RELAYER_POOLS or RELAYER_CONFIG)");
  const seen = new Set<string>();
  return list.map((p, i) => {
    const e = p as Record<string, unknown>;
    const chainId = Number(e.chainId);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`pool ${i}: bad chainId`);
    if (typeof e.pool !== "string" || !isAddress(e.pool, { strict: false })) throw new Error(`pool ${i}: bad pool address`);
    const fee = e.minFee ?? "0";
    if ((typeof fee !== "string" && typeof fee !== "number") || !/^\d+$/.test(String(fee))) throw new Error(`pool ${i}: minFee must be a base-unit integer`);
    if (e.rpc !== undefined && typeof e.rpc !== "string") throw new Error(`pool ${i}: rpc must be a URL string`);
    const pool = getAddress(e.pool);
    const key = `${chainId}:${pool}`;
    if (seen.has(key)) throw new Error(`pool ${i}: duplicate ${key}`);
    seen.add(key);
    return { chainId, pool, minFee: BigInt(fee), ...(e.rpc ? { rpc: e.rpc as string } : {}) };
  });
}

export function loadRelayerConfig(env: Record<string, string | undefined> = process.env): RelayerConfig {
  const key = env.RELAYER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RELAYER_KEY must be set to a 0x-prefixed 32-byte private key");
  const port = Number(env.RELAYER_PORT ?? "3715");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("RELAYER_PORT must be a TCP port");
  let raw: unknown;
  if (env.RELAYER_POOLS) raw = JSON.parse(env.RELAYER_POOLS);
  else if (env.RELAYER_CONFIG) raw = JSON.parse(readFileSync(env.RELAYER_CONFIG, "utf8"));
  return { port, host: env.RELAYER_HOST ?? "127.0.0.1", account: privateKeyToAccount(key as Hex), pools: parsePools(raw) };
}
