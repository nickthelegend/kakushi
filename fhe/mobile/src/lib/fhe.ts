// The client side of Kakushi, adapted from sdk/src/index.ts (@kakushi/fhe-sdk) for React Native:
//  - encrypt: tfhe 1.8.1 runs in a hidden WebView (src/fhe), never in plaintext off the device;
//    the gateway attests the ciphertext list and returns {handle, proof} bound to (contract, user).
//  - userDecrypt: EIP-712 signed request; the gateway seals each value to a fresh P-256 key made
//    here and only this call can open it (src/lib/seal.ts, no WebCrypto needed).
import { ephemeralKey, unseal, type SealedValue } from "./seal.ts";
import { toB64, type Hex } from "./bytes.ts";

export const KakushiType = { ebool: 0, euint32: 3, euint64: 4 } as const;
export type KakushiTypeName = keyof typeof KakushiType;

/** Produces a serialized tfhe CompactCiphertextList under the network public key. */
export interface Encryptor {
  encrypt(publicKey: Uint8Array, type: number, value: bigint | boolean): Promise<Uint8Array>;
}

export interface EncryptedInput {
  handle: Hex;
  proof: Hex;
  ms: { encrypt: number; attest: number };
}

export type UserDecryptTypedData = ReturnType<typeof userDecryptTypedData>;

export function userDecryptTypedData(chainId: number, handles: Hex[], contract: Hex, publicKey: Hex, expiresAt: bigint) {
  return {
    domain: { name: "Kakushi FHE", version: "1", chainId },
    types: {
      UserDecrypt: [
        { name: "handles", type: "bytes32[]" },
        { name: "contractAddress", type: "address" },
        { name: "publicKey", type: "bytes" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    primaryType: "UserDecrypt" as const,
    message: { handles, contractAddress: contract, publicKey, expiresAt },
  };
}

export class KakushiFheClient {
  private pk: Uint8Array | null = null;
  readonly gatewayUrl: string;
  readonly chainId: number;
  readonly encryptor: Encryptor;
  constructor(gatewayUrl: string, chainId: number, encryptor: Encryptor) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, "");
    this.chainId = chainId;
    this.encryptor = encryptor;
  }

  async publicKey(): Promise<Uint8Array> {
    if (!this.pk) {
      const r = await fetch(`${this.gatewayUrl}/keys/public`);
      if (!r.ok) throw new Error(`gateway: public key unavailable (${r.status})`);
      this.pk = new Uint8Array(await r.arrayBuffer());
    }
    return this.pk;
  }

  /** Encrypt `value` for `contract`, called by `user`. The chain sees only a handle and a proof. */
  async encrypt(type: KakushiTypeName, value: bigint | number | boolean, contract: Hex, user: Hex): Promise<EncryptedInput> {
    const t0 = Date.now();
    const list = await this.encryptor.encrypt(await this.publicKey(), KakushiType[type], typeof value === "number" ? BigInt(value) : value);
    const t1 = Date.now();
    const r = await fetch(`${this.gatewayUrl}/inputs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ciphertext: toB64(list), type: KakushiType[type], user, contract }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`gateway: ${j.error ?? r.status}`);
    return { handle: j.handle, proof: j.proof, ms: { encrypt: t1 - t0, attest: Date.now() - t1 } };
  }

  /** Reveal handles `user` may read (ACL), e.g. their own confidential balance. */
  async userDecrypt(handles: Hex[], contract: Hex, user: Hex, sign: (td: UserDecryptTypedData) => Promise<Hex>, ttlSec = 300): Promise<Record<string, bigint>> {
    const { secret, publicKeyHex } = ephemeralKey();
    try {
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlSec);
      const signature = await sign(userDecryptTypedData(this.chainId, handles, contract, publicKeyHex, expiresAt));
      const r = await fetch(`${this.gatewayUrl}/decrypt/user`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handles, contract, user, publicKey: publicKeyHex, expiresAt: expiresAt.toString(), signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`gateway: ${j.error ?? r.status}`);
      const out: Record<string, bigint> = {};
      for (const s of j.sealed as SealedValue[]) out[s.handle.toLowerCase()] = unseal(secret, s);
      return out;
    } finally {
      secret.fill(0);
    }
  }
}
