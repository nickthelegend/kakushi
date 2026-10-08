// Maker signers.
//  - local: a private key from env (MAKER_KEY). Local forks use anvil's public dev keys.
//  - privy: a Privy SERVER WALLET. The Maker's hot key never touches this machine, and the
//    wallet's Privy POLICY only allows PayoutRouter.fill/refund and DisputeModule.answerDispute
//    up to the pair limit (scripts/privy-setup.ts creates both). Privy refuses anything else,
//    so a compromised Maker host cannot drain inventory to an arbitrary address.
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { type Account, type Hex, type TransactionSerializable, serializeTransaction } from "viem";
import { privateKeyToAccount, toAccount } from "viem/accounts";

export interface PrivyConfig {
  appId: string;
  appSecret: string;
  walletId: string;
  address: Hex;
  /** base64 PKCS#8 P-256 key ("wallet-auth:" prefix allowed), required when the wallet has an owner */
  authorizationKey?: string;
  apiUrl?: string;
}

export function privyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PrivyConfig | null {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  const walletId = env.PRIVY_MAKER_WALLET_ID;
  const address = env.PRIVY_MAKER_WALLET_ADDRESS as Hex | undefined;
  if (!appId || !appSecret || !walletId || !address) return null;
  return { appId, appSecret, walletId, address, authorizationKey: env.PRIVY_AUTHORIZATION_KEY, apiUrl: env.PRIVY_API_URL };
}

/** Canonical JSON (sorted keys), as Privy's authorization signature payload requires. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
    .join(",")}}`;
}

/** privy-authorization-signature: ECDSA P-256 / SHA-256 over the canonical request, base64 DER. */
export function authorizationSignature(key: string, payload: { url: string; body: unknown; appId: string }): string {
  const pkcs8 = Buffer.from(key.replace(/^wallet-auth:/, ""), "base64");
  const pk = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const msg = canonicalize({ version: 1, method: "POST", url: payload.url, body: payload.body, headers: { "privy-app-id": payload.appId } });
  return cryptoSign("sha256", Buffer.from(msg), pk).toString("base64");
}

const hexq = (x: bigint | number | undefined) => (x === undefined ? undefined : `0x${BigInt(x).toString(16)}`);

/** A viem Account whose signTransaction is performed by Privy's wallet RPC. */
export function privyAccount(cfg: PrivyConfig): Account {
  const api = cfg.apiUrl ?? "https://api.privy.io";
  return toAccount({
    address: cfg.address,
    async signMessage() {
      throw new Error("Privy maker signer only signs PayoutRouter / DisputeModule transactions");
    },
    async signTypedData() {
      throw new Error("Privy maker signer only signs PayoutRouter / DisputeModule transactions");
    },
    async signTransaction(tx: TransactionSerializable) {
      const url = `${api}/v1/wallets/${cfg.walletId}/rpc`;
      const body = {
        method: "eth_signTransaction",
        params: {
          transaction: {
            to: tx.to,
            data: tx.data,
            value: hexq(tx.value ?? 0n),
            chain_id: tx.chainId,
            nonce: hexq(tx.nonce),
            gas_limit: hexq(tx.gas),
            max_fee_per_gas: hexq((tx as { maxFeePerGas?: bigint }).maxFeePerGas),
            max_priority_fee_per_gas: hexq((tx as { maxPriorityFeePerGas?: bigint }).maxPriorityFeePerGas),
            type: 2,
          },
        },
      };
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "privy-app-id": cfg.appId,
        authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString("base64")}`,
      };
      if (cfg.authorizationKey) headers["privy-authorization-signature"] = authorizationSignature(cfg.authorizationKey, { url, body, appId: cfg.appId });
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const j = (await r.json()) as { data?: { signed_transaction?: Hex }; error?: string; message?: string };
      if (!r.ok || !j.data?.signed_transaction) {
        // a policy refusal surfaces here: Privy declined to sign
        throw new Error(`Privy refused to sign: ${r.status} ${j.error ?? j.message ?? JSON.stringify(j)}`);
      }
      return j.data.signed_transaction;
    },
  });
}

export type SignerInfo = { account: Account; kind: "local" | "privy" };

export function makerSigner(env: NodeJS.ProcessEnv = process.env): SignerInfo {
  const privy = privyConfigFromEnv(env);
  if (privy && env.MAKER_SIGNER !== "local") return { account: privyAccount(privy), kind: "privy" };
  const key = env.MAKER_KEY as Hex | undefined;
  if (!key) throw new Error("MAKER_KEY is not set (or configure a Privy server wallet: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_MAKER_WALLET_ID, PRIVY_MAKER_WALLET_ADDRESS)");
  return { account: privateKeyToAccount(key), kind: "local" };
}

export { serializeTransaction };
