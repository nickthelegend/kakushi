// Server-side transaction helpers for the Kakushi Pay API routes (never imported by client code).
import "server-only";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendRawSync } from "@kakushi/fhe-sdk/monad";
import { network, privyServer, rpcUrl } from "@/lib/server";
import { MONAD_TESTNET_ID, payChain } from "./core";

let pub: PublicClient | null = null;
export function serverClient(): PublicClient {
  pub ??= createPublicClient({ chain: payChain(rpcUrl(), network() === "local"), transport: http(rpcUrl()) }) as PublicClient;
  return pub;
}

export interface ServerSent {
  hash: Hex;
  blockNumber: bigint;
  status: "success" | "reverted";
  sync: boolean;
  ms: number;
  via: "local-dev-key" | "privy-server-wallet" | "privy-server-wallet-sponsored";
}

// one in-flight tx per server key: anvil and Monad both reject a reused nonce
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(k) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(k, next);
  return next;
}

/** Sign with a LOCAL ANVIL ONLY key and broadcast with eth_sendRawTransactionSync. */
export function sendFromLocalKey(key: Hex, tx: { to: Hex; data: Hex; gas: bigint }): Promise<ServerSent> {
  if (network() !== "local") throw new Error("local dev keys are only used on the local fork");
  const acct = privateKeyToAccount(key);
  return serialize(acct.address, async () => {
    const c = serverClient();
    const [nonce, fees] = await Promise.all([c.getTransactionCount({ address: acct.address, blockTag: "pending" }), c.estimateFeesPerGas()]);
    const raw = await acct.signTransaction({ chainId: MONAD_TESTNET_ID, type: "eip1559", to: tx.to, data: tx.data, gas: tx.gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    const r = await sendRawSync(c, raw);
    return { hash: r.hash, blockNumber: r.blockNumber, status: r.status, sync: r.sync, ms: r.ms, via: "local-dev-key" as const };
  });
}

/**
 * Send from the Privy server wallet (the payroll operator). Its policy (scripts/privy-setup.ts) only
 * allows runPayrollFrom on cAUSD, on chain 10143, before a fixed time; anything else is refused by
 * Privy's enclave before a signature exists.
 *   sponsor=true  -> privy.wallets().ethereum().sendTransaction(..., sponsor: true): Privy pays gas
 *   sponsor=false -> sign through createViemAccount (eth_signTransaction), broadcast here with
 *                    eth_sendRawTransactionSync (works against any RPC, including a fork)
 */
export async function sendFromPrivyServerWallet(tx: { to: Hex; data: Hex; gas: bigint }): Promise<ServerSent> {
  const p = privyServer();
  if (!p.serverWalletReady) throw new Error("Privy server wallet not configured (see app/PRIVY.md)");
  const { PrivyClient } = await import("@privy-io/node");
  const privy = new PrivyClient({ appId: p.appId!, appSecret: p.appSecret! });
  const authorizationContext = p.authorizationKey ? { authorization_private_keys: [p.authorizationKey] } : undefined;
  const t0 = Date.now();
  const c = serverClient();
  if (p.sponsor) {
    const res = await privy.wallets().ethereum().sendTransaction(p.walletId!, {
      caip2: `eip155:${MONAD_TESTNET_ID}`,
      params: { transaction: { to: tx.to, data: tx.data, chain_id: MONAD_TESTNET_ID, gas_limit: `0x${tx.gas.toString(16)}` } },
      sponsor: true,
      ...(authorizationContext ? { authorization_context: authorizationContext } : {}),
    });
    // sponsored EVM sends return before inclusion: poll Privy for the final transaction hash
    let hash = (res.hash || null) as Hex | null;
    const id = (res as { transaction_id?: string }).transaction_id;
    const end = Date.now() + 60_000;
    while (!hash && id && Date.now() < end) {
      const t = await privy.transactions().get(id);
      if (t.transaction_hash) hash = t.transaction_hash as Hex;
      else if (t.status === "failed" || t.status === "execution_reverted") throw new Error(`Privy transaction ${id} ${t.status}`);
      else await new Promise((r) => setTimeout(r, 250));
    }
    if (!hash) throw new Error("Privy did not return a transaction hash in time");
    const rc = await c.waitForTransactionReceipt({ hash, pollingInterval: 100 });
    return { hash, blockNumber: rc.blockNumber, status: rc.status, sync: false, ms: Date.now() - t0, via: "privy-server-wallet-sponsored" };
  }
  const { createViemAccount } = await import("@privy-io/node/viem");
  const account = createViemAccount(privy, { walletId: p.walletId!, address: p.walletAddress!, authorizationContext });
  return serialize(p.walletAddress!, async () => {
    const [nonce, fees] = await Promise.all([c.getTransactionCount({ address: p.walletAddress!, blockTag: "pending" }), c.estimateFeesPerGas()]);
    const raw = await account.signTransaction({ chainId: MONAD_TESTNET_ID, type: "eip1559", to: tx.to, data: tx.data, gas: tx.gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    const r = await sendRawSync(c, raw);
    return { hash: r.hash, blockNumber: r.blockNumber, status: r.status, sync: r.sync, ms: Date.now() - t0, via: "privy-server-wallet" as const };
  });
}
