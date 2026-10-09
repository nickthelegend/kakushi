// Framework-agnostic core of @kakushi/widget: resolve the recipient, make a one-time stealth
// address, approve if needed, and pay it through StealthPay in one transaction.
//
// No React, no DOM: the component and the hook are thin wrappers around createKakushiPayment.
import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  BaseError,
  UserRejectedRequestError,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  toHex,
} from "viem";
import { STEALTH_SCHEME_ID, type StealthMetaAddress, generateStealthAddress, parseMetaAddress, readStealthMetaAddress, toMetaAddress } from "@kakushi/sdk";

/** StealthPay: pays a stealth address and announces it on the ERC-5564 announcer. */
export const stealthPayAbi = parseAbi([
  "function sendNative(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes1 viewTag) payable",
  "function sendToken(uint256 schemeId, address stealthAddress, address token, uint256 amount, bytes ephemeralPubKey, bytes1 viewTag) payable",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/** The two privacy-layer addresses the widget needs. A `privacy` entry of
 *  @kakushi/config/deployments fits as is. */
export interface KakushiDeployment {
  /** ERC-6538 registry: needed only when `to` is a plain address */
  stealthRegistry?: Address;
  stealthPay: Address;
}

/** "native" for the chain's coin, else the ERC-20 address. */
export type KakushiToken = "native" | Address;

export type KakushiPayStatus = "idle" | "resolving" | "confirming" | "sending" | "paid" | "error";

/** Which transaction a "confirming"/"sending" status refers to. */
export type KakushiPayStep = "approve" | "pay";

export interface KakushiStatusEvent {
  status: KakushiPayStatus;
  step?: KakushiPayStep;
  txHash?: Hex;
}

export type KakushiErrorCode =
  | "INVALID_RECIPIENT"
  | "RECIPIENT_NOT_REGISTERED"
  | "NO_REGISTRY"
  | "INVALID_AMOUNT"
  | "INVALID_TOKEN"
  | "NO_ACCOUNT"
  | "WRONG_CHAIN"
  | "USER_REJECTED"
  | "TX_REVERTED"
  | "UNKNOWN";

export class KakushiPayError extends Error {
  override name = "KakushiPayError";
  readonly code: KakushiErrorCode;
  constructor(code: KakushiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** A wallet client, or a function returning one (for wallets that connect lazily). */
export type WalletClientSource = WalletClient | (() => WalletClient | Promise<WalletClient>);

export interface KakushiPaymentOptions {
  /** stealth meta-address (st:eth:0x…) or a plain address registered on ERC-6538 */
  to: string;
  /** base units as a bigint, or a decimal string ("12.5") scaled by `decimals` */
  amount: bigint | string;
  /** default "native" */
  token?: KakushiToken;
  walletClient: WalletClientSource;
  publicClient: PublicClient;
  deployment: KakushiDeployment;
  /** the chain to pay on; defaults to the wallet client's chain. The wallet is asked to switch
   *  when it is on another one. */
  chain?: Chain;
  /** payer; defaults to the wallet client's account, else its first address */
  account?: Account | Address;
  /** decimals for a string `amount`; defaults to the chain's native decimals or the token's decimals() */
  decimals?: number;
  /** native coin sent along with an ERC-20 payment so the stealth address has gas to move it (wei) */
  stealthGas?: bigint;
  /** receipts to wait for; default 1 */
  confirmations?: number;
  onStatus?: (e: KakushiStatusEvent) => void;
}

export interface KakushiPaymentResult {
  txHash: Hex;
  stealthAddress: Address;
  ephemeralPublicKey: Hex;
  viewTag: number;
  /** the recipient's meta-address the payment was derived from */
  metaAddress: StealthMetaAddress;
  /** base units actually paid */
  amount: bigint;
  token: KakushiToken;
  chainId: number;
  /** set when an ERC-20 approval was sent first */
  approveTxHash?: Hex;
  receipt: TransactionReceipt;
}

// ------------------------------------------------------------------ recipient

const META_PREFIX = /^st:[a-z0-9]+:0x/i;

/** True for st:<chain>:0x… or bare 33/66 compressed key bytes. */
export function isStealthMetaAddress(s: string): boolean {
  if (!META_PREFIX.test(s) && !/^0x[0-9a-fA-F]{66}$|^0x[0-9a-fA-F]{132}$/.test(s)) return false;
  try {
    parseMetaAddress(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * The recipient's meta-address: `to` itself when it is one, else its ERC-6538 registration.
 * Throws RECIPIENT_NOT_REGISTERED when the address hasn't enabled private receiving.
 */
export async function resolveRecipient(to: string, publicClient: PublicClient, deployment: Pick<KakushiDeployment, "stealthRegistry">): Promise<StealthMetaAddress> {
  const v = to.trim();
  if (v.startsWith("st:") || (v.startsWith("0x") && v.length > 42)) {
    try {
      const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(v);
      return toMetaAddress(spendingPublicKey, viewingPublicKey);
    } catch (e) {
      throw new KakushiPayError("INVALID_RECIPIENT", `Not a valid stealth meta-address: ${(e as Error).message}`, { cause: e });
    }
  }
  if (!isAddress(v, { strict: false })) throw new KakushiPayError("INVALID_RECIPIENT", "Recipient must be a stealth meta-address (st:eth:0x…) or a 0x wallet address.");
  if (!deployment.stealthRegistry) throw new KakushiPayError("NO_REGISTRY", "This deployment has no stealth registry, so a plain address can't be resolved. Pass the recipient's st:eth:0x… meta-address instead.");
  let meta: StealthMetaAddress | null;
  try {
    meta = await readStealthMetaAddress(publicClient, deployment.stealthRegistry, getAddress(v), STEALTH_SCHEME_ID);
  } catch (e) {
    throw new KakushiPayError("UNKNOWN", `Couldn't look up the recipient's private address: ${shortMessage(e)}`, { cause: e });
  }
  if (!meta) throw new KakushiPayError("RECIPIENT_NOT_REGISTERED", "This recipient hasn't enabled private receiving yet. Ask them to turn it on in Kakushi (Receive), or to share their st:eth: meta-address.");
  return meta;
}

// ------------------------------------------------------------------ payment

async function getWallet(src: WalletClientSource): Promise<WalletClient> {
  return typeof src === "function" ? await src() : src;
}

async function payerOf(wallet: WalletClient, explicit?: Account | Address): Promise<Account | Address> {
  if (explicit) return explicit;
  if (wallet.account) return wallet.account;
  let addrs = await wallet.getAddresses().catch(() => [] as Address[]);
  if (!addrs.length) addrs = await wallet.requestAddresses().catch((e: unknown) => {
    throw toKakushiError(e);
  });
  const a = addrs[0];
  if (!a) throw new KakushiPayError("NO_ACCOUNT", "Connect a wallet to pay.");
  return a;
}

const addressOf = (a: Account | Address): Address => (typeof a === "string" ? a : a.address);

async function ensureChain(wallet: WalletClient, chain: Chain | undefined): Promise<Chain | undefined> {
  const target = chain ?? wallet.chain;
  if (!target) return undefined;
  const current = await wallet.getChainId();
  if (current === target.id) return target;
  try {
    await wallet.switchChain({ id: target.id });
  } catch (e) {
    const k = toKakushiError(e);
    if (k.code === "USER_REJECTED") throw k;
    throw new KakushiPayError("WRONG_CHAIN", `Switch your wallet to ${target.name} (chain ${target.id}) to pay.`, { cause: e });
  }
  return target;
}

async function toBaseUnits(o: KakushiPaymentOptions, chain: Chain | undefined): Promise<bigint> {
  if (typeof o.amount === "bigint") return o.amount;
  const s = o.amount.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) throw new KakushiPayError("INVALID_AMOUNT", `Amount "${o.amount}" is not a number.`);
  let decimals = o.decimals;
  if (decimals === undefined) {
    if (!o.token || o.token === "native") decimals = chain?.nativeCurrency.decimals ?? 18;
    else decimals = Number(await o.publicClient.readContract({ address: o.token, abi: erc20Abi, functionName: "decimals" }));
  }
  try {
    return parseUnits(s, decimals);
  } catch (e) {
    throw new KakushiPayError("INVALID_AMOUNT", `Amount "${o.amount}" is not valid.`, { cause: e });
  }
}

async function confirmed(publicClient: PublicClient, hash: Hex, confirmations: number, what: string): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations });
  if (receipt.status !== "success") throw new KakushiPayError("TX_REVERTED", `${what} transaction reverted (${hash}).`);
  return receipt;
}

/**
 * One private payment, end to end:
 *   resolving   meta-address from `to` (ERC-6538 lookup for a plain address)
 *   confirming  [ERC-20 without allowance] approve StealthPay for exactly `amount`, then
 *   sending       wait for it
 *   confirming  StealthPay.sendNative / sendToken to a fresh stealth address
 *   sending     wait for the receipt
 *   paid
 * Throws KakushiPayError (also reported as an "error" status).
 */
export async function createKakushiPayment(o: KakushiPaymentOptions): Promise<KakushiPaymentResult> {
  const emit = (e: KakushiStatusEvent) => o.onStatus?.(e);
  try {
    const token: KakushiToken = o.token ?? "native";
    if (token !== "native" && !isAddress(token, { strict: false })) throw new KakushiPayError("INVALID_TOKEN", `Token must be "native" or an ERC-20 address, got ${String(token)}.`);
    const native = token === "native";

    emit({ status: "resolving" });
    const metaAddress = await resolveRecipient(o.to, o.publicClient, o.deployment);
    const wallet = await getWallet(o.walletClient);
    const chain = await ensureChain(wallet, o.chain);
    const amount = await toBaseUnits(o, chain);
    if (amount <= 0n) throw new KakushiPayError("INVALID_AMOUNT", "Amount must be greater than zero.");
    const account = await payerOf(wallet, o.account);
    const payer = addressOf(account);
    const confirmations = o.confirmations ?? 1;
    const stealthPay = getAddress(o.deployment.stealthPay);

    let approveTxHash: Hex | undefined;
    if (!native) {
      const allowance = await o.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [payer, stealthPay] });
      if (allowance < amount) {
        emit({ status: "confirming", step: "approve" });
        approveTxHash = await wallet.writeContract({ chain: chain ?? null, account, address: token, abi: erc20Abi, functionName: "approve", args: [stealthPay, amount] });
        emit({ status: "sending", step: "approve", txHash: approveTxHash });
        await confirmed(o.publicClient, approveTxHash, confirmations, "Approval");
      }
    }

    const s = generateStealthAddress(metaAddress);
    const viewTag = toHex(s.viewTag, { size: 1 });
    emit({ status: "confirming", step: "pay" });
    const txHash = native
      ? await wallet.writeContract({ chain: chain ?? null, account, address: stealthPay, abi: stealthPayAbi, functionName: "sendNative", args: [STEALTH_SCHEME_ID, s.stealthAddress, s.ephemeralPublicKey, viewTag], value: amount })
      : await wallet.writeContract({ chain: chain ?? null, account, address: stealthPay, abi: stealthPayAbi, functionName: "sendToken", args: [STEALTH_SCHEME_ID, s.stealthAddress, token, amount, s.ephemeralPublicKey, viewTag], value: o.stealthGas ?? 0n });
    emit({ status: "sending", step: "pay", txHash });
    const receipt = await confirmed(o.publicClient, txHash, confirmations, "Payment");

    const result: KakushiPaymentResult = {
      txHash,
      stealthAddress: getAddress(s.stealthAddress),
      ephemeralPublicKey: s.ephemeralPublicKey,
      viewTag: s.viewTag,
      metaAddress,
      amount,
      token,
      chainId: chain?.id ?? (await o.publicClient.getChainId()),
      receipt,
      ...(approveTxHash ? { approveTxHash } : {}),
    };
    emit({ status: "paid", step: "pay", txHash });
    return result;
  } catch (e) {
    const err = toKakushiError(e);
    emit({ status: "error" });
    throw err;
  }
}

// ------------------------------------------------------------------ errors

function shortMessage(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  return ((e as Error)?.message ?? String(e)).split("\n")[0]!;
}

/** Any thrown value as a KakushiPayError with a message fit for end users. */
export function toKakushiError(e: unknown): KakushiPayError {
  if (e instanceof KakushiPayError) return e;
  const rejected =
    (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError || (x as { code?: number }).code === 4001)) ||
    (e as { code?: number })?.code === 4001;
  if (rejected) return new KakushiPayError("USER_REJECTED", "You cancelled the payment in your wallet.", { cause: e });
  return new KakushiPayError("UNKNOWN", shortMessage(e), { cause: e });
}
