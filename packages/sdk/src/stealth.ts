// ERC-5564 stealth addresses, scheme 1 (secp256k1 with view tags), and ERC-6538 registry helpers.
//
// Scheme 1, byte for byte as the reference SDK (ScopeLift/stealth-address-sdk):
//   meta-address   st:eth:0x<spendingPub (33 B compressed)><viewingPub (33 B compressed)>
//   sender         p_e random; P_e = p_e·G (published compressed, 33 B)
//                  s   = p_e · P_view            (point, serialized COMPRESSED, 33 B)
//                  s_h = keccak256(s)            (32 B)
//                  viewTag = s_h[0]
//                  P_stealth = P_spend + s_h·G;  stealthAddress = keccak256(P_stealth.xy)[12:]
//   recipient      s = p_view · P_e, same s_h; p_stealth = (p_spend + s_h) mod n
//
// Announcement metadata (ERC-5564 "recommended" layout, plus one optional Kakushi field):
//   offset  size  field
//   0       1     viewTag (MUST, per ERC-5564)
//   1       4     selector: 0xeeeeeeee for native coin, 0xa9059cbb (ERC-20 transfer) for tokens
//   5       20    token: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native, else the token address
//   25      32    amount (uint256, big-endian)
//   57      32    dstChainId (uint256, big-endian) - OPTIONAL Kakushi extension: the chain the
//                 funds are (or will be) on when the payment was routed cross-chain
// Metadata shorter than 57 bytes carries only what is present (e.g. just the view tag).
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  type Hex,
  type PublicClient,
  bytesToHex,
  concat,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  size,
  slice,
  stringToBytes,
  toHex,
} from "viem";
import { publicKeyToAddress } from "viem/accounts";

export const STEALTH_SCHEME_ID = 1n;
/** The message a wallet signs (EIP-191 personal_sign) to derive its stealth keys. */
export const STEALTH_KEYS_MESSAGE = "Kakushi stealth keys v1";
/** ERC-5564 placeholder for the native coin, and its metadata selector. */
export const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const NATIVE_SELECTOR = "0xeeeeeeee" as const;
/** ERC-20 transfer(address,uint256) selector, used as the metadata selector for token payments. */
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;

const N = secp256k1.CURVE.n;
const Point = secp256k1.ProjectivePoint;

export type StealthMetaAddress = `st:${string}:0x${string}`;

export interface StealthKeys {
  spendingKey: Hex;
  viewingKey: Hex;
  /** compressed, 33 bytes */
  spendingPublicKey: Hex;
  /** compressed, 33 bytes */
  viewingPublicKey: Hex;
  metaAddress: StealthMetaAddress;
}

export interface GeneratedStealthAddress {
  stealthAddress: Hex;
  /** compressed, 33 bytes: the `ephemeralPubKey` to announce */
  ephemeralPublicKey: Hex;
  /** 0..255: metadata[0] */
  viewTag: number;
}

// ------------------------------------------------------------------ keys

const scalarHex = (x: bigint): Hex => pad(numberToHex(x), { size: 32 });

function toScalar(h: Hex, what: string): bigint {
  const x = BigInt(h) % N;
  if (x === 0n) throw new Error(`${what} reduces to zero`);
  return x;
}

function compressedPub(priv: bigint): Hex {
  return bytesToHex(Point.BASE.multiply(priv).toRawBytes(true));
}

/**
 * Deterministic stealth keys from a wallet signature over STEALTH_KEYS_MESSAGE (or any secret
 * seed of at least 32 bytes). The wallet must sign deterministically (RFC 6979, as every common
 * EOA wallet does), otherwise the keys change between sessions.
 *
 *   h           = keccak256(seed)
 *   spendingKey = keccak256(h ‖ "kakushi/stealth/spending") mod n
 *   viewingKey  = keccak256(h ‖ "kakushi/stealth/viewing")  mod n
 */
export function generateStealthKeys(seedOrSignature: Hex): StealthKeys {
  if (!/^0x[0-9a-fA-F]*$/.test(seedOrSignature) || size(seedOrSignature) < 32) {
    throw new Error("stealth key seed must be a hex string of at least 32 bytes (a wallet signature)");
  }
  const h = keccak256(seedOrSignature);
  const spend = toScalar(keccak256(concat([h, toHex(stringToBytes("kakushi/stealth/spending"))])), "spending key");
  const view = toScalar(keccak256(concat([h, toHex(stringToBytes("kakushi/stealth/viewing"))])), "viewing key");
  return stealthKeysFromPrivateKeys(scalarHex(spend), scalarHex(view));
}

/** Keys and meta-address from existing spending/viewing private keys. */
export function stealthKeysFromPrivateKeys(spendingKey: Hex, viewingKey: Hex): StealthKeys {
  const spend = toScalar(spendingKey, "spending key");
  const view = toScalar(viewingKey, "viewing key");
  const spendingPublicKey = compressedPub(spend);
  const viewingPublicKey = compressedPub(view);
  return {
    spendingKey: scalarHex(spend),
    viewingKey: scalarHex(view),
    spendingPublicKey,
    viewingPublicKey,
    metaAddress: toMetaAddress(spendingPublicKey, viewingPublicKey),
  };
}

/** Sign STEALTH_KEYS_MESSAGE with any signer (viem account / wallet client) and derive the keys. */
export async function deriveStealthKeys(signer: { signMessage: (args: { message: string }) => Promise<Hex> }): Promise<StealthKeys> {
  return generateStealthKeys(await signer.signMessage({ message: STEALTH_KEYS_MESSAGE }));
}

export function toMetaAddress(spendingPublicKey: Hex, viewingPublicKey: Hex, chain = "eth"): StealthMetaAddress {
  const sp = normalizePub(spendingPublicKey);
  const vp = normalizePub(viewingPublicKey);
  return `st:${chain}:${concat([sp, vp])}` as StealthMetaAddress;
}

function normalizePub(pub: Hex): Hex {
  try {
    return bytesToHex(Point.fromHex(pub.slice(2)).toRawBytes(true));
  } catch {
    throw new Error(`invalid secp256k1 public key ${pub}`);
  }
}

/**
 * Parse "st:<chain>:0x<spend><view>" or the bare 0x… bytes (as stored in ERC-6538). A single
 * 33-byte key means spending key = viewing key (allowed by the reference SDK).
 */
export function parseMetaAddress(metaAddress: string): { spendingPublicKey: Hex; viewingPublicKey: Hex } {
  let hex = metaAddress;
  if (!metaAddress.startsWith("0x")) {
    const parts = metaAddress.split(":");
    if (parts.length !== 3 || parts[0] !== "st" || !parts[1]) throw new Error("stealth meta-address must look like st:<chain>:0x<keys>");
    hex = parts[2]!;
  }
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error("stealth meta-address keys must be hex");
  const n = (hex.length - 2) / 2;
  if (n !== 33 && n !== 66) throw new Error(`stealth meta-address must hold 33 or 66 bytes of compressed keys, got ${n}`);
  const sp = slice(hex as Hex, 0, 33);
  const vp = n === 66 ? slice(hex as Hex, 33, 66) : sp;
  for (const k of [sp, vp]) {
    if (!k.startsWith("0x02") && !k.startsWith("0x03")) throw new Error("stealth meta-address keys must be compressed (02/03 prefix)");
  }
  return { spendingPublicKey: normalizePub(sp), viewingPublicKey: normalizePub(vp) };
}

// ------------------------------------------------------------------ scheme 1

/** keccak256 of the compressed ECDH point: the ERC-5564 scheme 1 hashed shared secret. */
function hashedSharedSecret(priv: bigint, pub: Hex): Hex {
  const shared = Point.fromHex(pub.slice(2)).multiply(priv).toRawBytes(true);
  return keccak256(shared);
}

function stealthAddressOf(spendingPublicKey: Hex, sh: Hex): Hex {
  const k = BigInt(sh) % N;
  let p = Point.fromHex(spendingPublicKey.slice(2));
  if (k !== 0n) p = p.add(Point.BASE.multiply(k));
  return publicKeyToAddress(bytesToHex(p.toRawBytes(false)));
}

/** Sender side: a fresh one-time address for the owner of `metaAddress`. */
export function generateStealthAddress(metaAddress: string, opts: { ephemeralPrivateKey?: Hex } = {}): GeneratedStealthAddress {
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(metaAddress);
  const eph = opts.ephemeralPrivateKey ? toScalar(opts.ephemeralPrivateKey, "ephemeral key") : BigInt(bytesToHex(secp256k1.utils.randomPrivateKey()));
  const sh = hashedSharedSecret(eph, viewingPublicKey);
  return {
    stealthAddress: stealthAddressOf(spendingPublicKey, sh),
    ephemeralPublicKey: compressedPub(eph),
    viewTag: Number(BigInt(slice(sh, 0, 1))),
  };
}

export interface AnnouncementLike {
  stealthAddress: Hex;
  ephemeralPubKey: Hex;
  /** metadata[0] is the view tag; omit (or pass "0x") to skip the fast path */
  metadata?: Hex;
}

/**
 * Recipient side: is this announcement ours? Rejects on view-tag mismatch with one ECDH + one
 * keccak (no point addition), so 255/256 foreign announcements cost almost nothing.
 */
export function checkStealthAddress(announcement: AnnouncementLike, viewingKey: Hex, spendingPublicKey: Hex): boolean {
  let sh: Hex;
  try {
    sh = hashedSharedSecret(toScalar(viewingKey, "viewing key"), announcement.ephemeralPubKey);
  } catch {
    return false; // malformed ephemeral key: anyone can announce garbage
  }
  const md = announcement.metadata;
  if (md && md.length >= 4 && Number(BigInt(slice(md, 0, 1))) !== Number(BigInt(slice(sh, 0, 1)))) return false;
  return stealthAddressOf(spendingPublicKey, sh).toLowerCase() === announcement.stealthAddress.toLowerCase();
}

/** The private key that controls the stealth address announced with `ephemeralPublicKey`. */
export function computeStealthPrivateKey(spendingKey: Hex, viewingKey: Hex, ephemeralPublicKey: Hex): Hex {
  const sh = hashedSharedSecret(toScalar(viewingKey, "viewing key"), ephemeralPublicKey);
  const k = (toScalar(spendingKey, "spending key") + BigInt(sh)) % N;
  if (k === 0n) throw new Error("stealth private key is zero");
  return scalarHex(k);
}

// ------------------------------------------------------------------ metadata

export interface StealthMetadataInput {
  viewTag: number;
  /** "native" (or NATIVE_TOKEN) for the native coin, else the ERC-20 address */
  token?: Hex | "native";
  amount?: bigint;
  dstChainId?: bigint | number;
}

export interface StealthMetadata {
  viewTag: number;
  selector?: Hex;
  kind?: "native" | "erc20" | "other";
  token?: Hex;
  amount?: bigint;
  dstChainId?: bigint;
}

/** Encode announcement metadata (layout at the top of this file). */
export function encodeStealthMetadata(m: StealthMetadataInput): Hex {
  if (!Number.isInteger(m.viewTag) || m.viewTag < 0 || m.viewTag > 255) throw new Error("viewTag must be a byte");
  const tag = numberToHex(m.viewTag, { size: 1 });
  if (m.token === undefined) {
    if (m.amount !== undefined || m.dstChainId !== undefined) throw new Error("amount/dstChainId need a token");
    return tag;
  }
  const native = m.token === "native" || m.token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  if (!native && !isAddress(m.token, { strict: false })) throw new Error(`bad token ${m.token}`);
  const amount = m.amount ?? 0n;
  if (amount < 0n || amount >= 2n ** 256n) throw new Error("amount out of range");
  const parts: Hex[] = [tag, native ? NATIVE_SELECTOR : ERC20_TRANSFER_SELECTOR, native ? NATIVE_TOKEN : (m.token as Hex), numberToHex(amount, { size: 32 })];
  if (m.dstChainId !== undefined) parts.push(numberToHex(BigInt(m.dstChainId), { size: 32 }));
  return concat(parts).toLowerCase() as Hex;
}

/** Decode announcement metadata; fields absent from short metadata are left undefined. */
export function decodeStealthMetadata(metadata: Hex): StealthMetadata {
  const n = size(metadata);
  if (n < 1) throw new Error("metadata is empty (ERC-5564 requires the view tag)");
  const out: StealthMetadata = { viewTag: Number(BigInt(slice(metadata, 0, 1))) };
  if (n >= 5) {
    out.selector = slice(metadata, 1, 5);
    out.kind = out.selector === NATIVE_SELECTOR ? "native" : out.selector === ERC20_TRANSFER_SELECTOR ? "erc20" : "other";
  }
  if (n >= 25) out.token = getAddress(slice(metadata, 5, 25));
  if (n >= 57) out.amount = BigInt(slice(metadata, 25, 57));
  if (n >= 89) out.dstChainId = BigInt(slice(metadata, 57, 89));
  return out;
}

// ------------------------------------------------------------------ on-chain: ERC-5564 / ERC-6538

export const erc5564AnnouncerAbi = parseAbi([
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
]);

export const erc6538RegistryAbi = parseAbi([
  "event StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress)",
  "function registerKeys(uint256 schemeId, bytes stealthMetaAddress)",
  "function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)",
]);

const erc20BalanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** The raw 66 key bytes (no "st:eth:" prefix) that ERC-6538 stores. */
export function metaAddressBytes(metaAddress: string): Hex {
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(metaAddress);
  return concat([spendingPublicKey, viewingPublicKey]);
}

/** Calldata for ERC6538Registry.registerKeys(1, <66 key bytes>), sent by the registrant. */
export function buildRegisterKeysCalldata(metaAddress: string, schemeId: bigint = STEALTH_SCHEME_ID): Hex {
  return encodeFunctionData({ abi: erc6538RegistryAbi, functionName: "registerKeys", args: [schemeId, metaAddressBytes(metaAddress)] });
}

/** The registrant's meta-address from ERC-6538, or null if none is registered. */
export async function readStealthMetaAddress(client: PublicClient, registry: Hex, registrant: Hex, schemeId: bigint = STEALTH_SCHEME_ID): Promise<StealthMetaAddress | null> {
  const raw = await client.readContract({ address: registry, abi: erc6538RegistryAbi, functionName: "stealthMetaAddressOf", args: [registrant, schemeId] });
  if (!raw || raw === "0x") return null;
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(raw);
  return toMetaAddress(spendingPublicKey, viewingPublicKey);
}

export interface ScanKeys {
  viewingKey: Hex;
  spendingPublicKey: Hex;
  /** when present, matches carry the stealth private key */
  spendingKey?: Hex;
}

export interface StealthMatch extends StealthMetadata {
  stealthAddress: Hex;
  ephemeralPublicKey: Hex;
  caller: Hex;
  metadata: Hex;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
  stealthPrivateKey?: Hex;
  /** balance of `token` (or native when no token is known), when `withBalances` is set */
  balance?: bigint;
}

export interface ScanOptions {
  /** eth_getLogs block range per request; Monad's public RPC refuses more than 100 */
  chunk?: bigint;
  schemeId?: bigint;
  /** also read each match's current balance */
  withBalances?: boolean;
  onProgress?: (scannedTo: bigint) => void;
}

/**
 * Scan an ERC-5564 announcer for announcements addressed to `keys`, paging eth_getLogs in
 * `chunk`-block ranges (same pattern as findPayout). Metadata that cannot be decoded still
 * matches if the stealth address checks out.
 */
export async function scanAnnouncements(client: PublicClient, announcer: Hex, fromBlock: bigint, toBlock: bigint, keys: ScanKeys, opts: ScanOptions = {}): Promise<StealthMatch[]> {
  const chunk = opts.chunk ?? 100n;
  if (chunk < 1n) throw new Error("chunk must be positive");
  const event = erc5564AnnouncerAbi[0];
  const out: StealthMatch[] = [];
  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
    const logs = await client.getLogs({ address: announcer, event, args: { schemeId: opts.schemeId ?? STEALTH_SCHEME_ID }, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args;
      if (!a.stealthAddress || !a.ephemeralPubKey || a.metadata === undefined || !a.caller) continue;
      if (!checkStealthAddress({ stealthAddress: a.stealthAddress, ephemeralPubKey: a.ephemeralPubKey, metadata: a.metadata }, keys.viewingKey, keys.spendingPublicKey)) continue;
      let md: StealthMetadata = { viewTag: -1 };
      try {
        md = decodeStealthMetadata(a.metadata);
      } catch {
        /* empty metadata: address matched anyway */
      }
      const m: StealthMatch = {
        ...md,
        stealthAddress: getAddress(a.stealthAddress),
        ephemeralPublicKey: a.ephemeralPubKey,
        caller: a.caller,
        metadata: a.metadata,
        blockNumber: l.blockNumber!,
        txHash: l.transactionHash!,
        logIndex: l.logIndex!,
      };
      if (keys.spendingKey) m.stealthPrivateKey = computeStealthPrivateKey(keys.spendingKey, keys.viewingKey, a.ephemeralPubKey);
      out.push(m);
    }
    opts.onProgress?.(to);
  }
  if (opts.withBalances) {
    for (const m of out) m.balance = await stealthBalance(client, m.stealthAddress, m.kind === "erc20" ? m.token : undefined);
  }
  return out;
}

/** Native balance, or the ERC-20 balance of `token`, held by a stealth address. */
export async function stealthBalance(client: PublicClient, stealthAddress: Hex, token?: Hex): Promise<bigint> {
  if (!token || token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return client.getBalance({ address: stealthAddress });
  return client.readContract({ address: token, abi: erc20BalanceAbi, functionName: "balanceOf", args: [stealthAddress] });
}
