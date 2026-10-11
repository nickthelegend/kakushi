// Accounts. The real path is Mera (Category Labs): a passkey's WebAuthn PRF output (32 bytes,
// deterministic per credential + salt) -> BIP-39 entropy -> BIP-44 m/44'/60'/0'/0/0 -> secp256k1 key
// held only inside a Mera signing session. No seed phrase to back up, nothing custodied: the same
// passkey restores the same address on a fresh install.
//
// DEV accounts (Foundry's public anvil keys) exist only for the local fork, so the payment flow can be
// exercised where passkeys cannot (no associated domain on localhost).
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  type EvmAddress,
  type WebAuthnClient,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { LocalAccount } from "viem";
import { hexToBytes, type Hex } from "./bytes.ts";

/** The PRF salt namespaces the derived key: same passkey, different salt -> unrelated account. */
export const FHISH_PRF_SALT = sha256(new TextEncoder().encode("fhish-pay.account.v1"));
export const EVM_PATH = "m/44'/60'/0'/0/0";

export interface Wallet {
  kind: "passkey" | "dev";
  address: EvmAddress;
  /** passkey credential id (base64url) or the dev account name */
  credentialId: string;
  account: LocalAccount;
  /** zeroes the session key; every later signature throws SESSION_ENDED */
  end(): void;
}

export const DEV_KEYS = {
  // LOCAL ANVIL ONLY: Foundry's public dev keys (published in Foundry's docs; hold AUSD on the fork).
  alice: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  bob: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  // the DEV gas sponsor: submits ERC-3009 wraps and link claims for accounts that hold no gas
  carol: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;
export type DevName = keyof typeof DEV_KEYS;

function walletFromKey(kind: Wallet["kind"], credentialId: string, privateKey: Uint8Array): Wallet {
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0); // the session keeps its own copy
  return { kind, credentialId, address: getEvmAddress(session.publicKey), account: toViemAccount(session), end: () => session.end() };
}

/** PRF output -> BIP-39 -> BIP-44 key -> signing session. Clears every buffer it can reach. */
export function walletFromPrf(credentialId: string, prfOutput: Uint8Array): Wallet {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  prfOutput.fill(0);
  try {
    const node = HDKey.fromMasterSeed(seed).derive(EVM_PATH);
    if (!node.privateKey) throw new Error("BIP-32 derivation produced no key");
    const w = walletFromKey("passkey", credentialId, Uint8Array.from(node.privateKey));
    node.wipePrivateData();
    return w;
  } finally {
    seed.fill(0);
  }
}

export function devWallet(name: DevName): Wallet {
  return walletFromKey("dev", name, hexToBytes(DEV_KEYS[name]));
}

export interface PasskeyEnv {
  rpId: string;
  rpName: string;
  webAuthnClient?: WebAuthnClient;
}

/** New passkey (one OS prompt; two on authenticators without create-time PRF) -> new account. */
export async function createPasskeyWallet(env: PasskeyEnv, label: string): Promise<Wallet> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: env.rpId, name: env.rpName },
    user: { name: label, displayName: label },
    prfSalt: FHISH_PRF_SALT,
    webAuthnClient: env.webAuthnClient,
  });
  return walletFromPrf(created.credentialId, created.prfOutput);
}

/**
 * Sign in with an existing passkey. With `credentialId` the ceremony is pinned to that passkey
 * (session renewal); without it the platform offers every passkey for the domain (restore on a new
 * device or a fresh install: nothing stored, the same address comes back).
 */
export async function passkeyWallet(env: PasskeyEnv, credentialId?: string): Promise<Wallet> {
  const r = await getPasskeyPrfOutput({
    rpId: env.rpId,
    prfSalt: FHISH_PRF_SALT,
    webAuthnClient: env.webAuthnClient,
    ...(credentialId ? { credential: { credentialId } } : {}),
  });
  return walletFromPrf(r.credentialId, r.prfOutput);
}
