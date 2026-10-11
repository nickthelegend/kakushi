// @fhish/sdk: the client side of Fhish on Monad.
import { parseAbi, type Account, type Hex, type PublicClient, type WalletClient } from "viem";

export const FhishType = { ebool: 0, euint32: 3, euint64: 4 } as const;
export type FhishTypeName = keyof typeof FhishType;

/** Produces a serialized tfhe CompactCiphertextList under the network public key. */
export interface Encryptor {
  encrypt(publicKey: Uint8Array, type: number, value: bigint | boolean): Promise<Uint8Array>;
}

export interface EncryptedInput {
  handle: Hex;
  proof: Hex;
  ms: { encrypt: number; attest: number };
}

export interface FhishClientOptions {
  gatewayUrl: string;
  chainId: number;
  encryptor: Encryptor;
  publicClient?: PublicClient;
}

const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const hexToBytes = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;

export class FhishClient {
  readonly o: FhishClientOptions;
  private pk: Uint8Array | null = null;

  constructor(o: FhishClientOptions) {
    this.o = { ...o, gatewayUrl: o.gatewayUrl.replace(/\/$/, "") };
  }

  async publicKey(): Promise<Uint8Array> {
    if (!this.pk) {
      const r = await fetch(`${this.o.gatewayUrl}/keys/public`);
      if (!r.ok) throw new Error(`gateway: public key unavailable (${r.status})`);
      this.pk = new Uint8Array(await r.arrayBuffer());
    }
    return this.pk;
  }

  /** Encrypt `value` for `contract`, called by `user`. Use the result as FHE.fromExternal(handle, proof). */
  async encrypt(type: FhishTypeName, value: bigint | number | boolean, contract: Hex, user: Hex): Promise<EncryptedInput> {
    const t0 = Date.now();
    const list = await this.o.encryptor.encrypt(await this.publicKey(), FhishType[type], typeof value === "number" ? BigInt(value) : value);
    const t1 = Date.now();
    const r = await fetch(`${this.o.gatewayUrl}/inputs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ciphertext: b64(list), type: FhishType[type], user, contract }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`gateway: ${j.error ?? r.status}`);
    return { handle: j.handle, proof: j.proof, ms: { encrypt: t1 - t0, attest: Date.now() - t1 } };
  }

  /**
   * Decrypt handles you are allowed to read (ACL), e.g. your confidential balance. The gateway seals
   * each value to a fresh P-256 key generated here; only this call can open it.
   */
  async userDecrypt(handles: Hex[], contract: Hex, wallet: WalletClient & { account: Account }, ttlSec = 300): Promise<Record<string, bigint>> {
    return this.userDecryptWith(handles, contract, wallet.account.address, (td) => wallet.signTypedData({ account: wallet.account, ...td } as never), ttlSec);
  }

  /** The EIP-712 request a user signs to read `handles` (exposed for wallets with their own signing API). */
  static userDecryptTypedData(chainId: number, handles: Hex[], contract: Hex, publicKey: Hex, expiresAt: bigint) {
    return {
      domain: { name: "Fhish", version: "1", chainId },
      types: { UserDecrypt: [{ name: "handles", type: "bytes32[]" }, { name: "contractAddress", type: "address" }, { name: "publicKey", type: "bytes" }, { name: "expiresAt", type: "uint256" }] },
      primaryType: "UserDecrypt" as const,
      message: { handles, contractAddress: contract, publicKey, expiresAt },
    };
  }

  /** userDecrypt with any signer: `sign` receives the EIP-712 typed data and returns the signature. */
  async userDecryptWith(
    handles: Hex[],
    contract: Hex,
    user: Hex,
    sign: (typedData: ReturnType<typeof FhishClient.userDecryptTypedData>) => Promise<Hex>,
    ttlSec = 300,
  ): Promise<Record<string, bigint>> {
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const publicKey = bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlSec);
    const signature = await sign(FhishClient.userDecryptTypedData(this.o.chainId, handles, contract, publicKey, expiresAt));
    const r = await fetch(`${this.o.gatewayUrl}/decrypt/user`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handles, contract, user, publicKey, expiresAt: expiresAt.toString(), signature }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`gateway: ${j.error ?? r.status}`);
    const out: Record<string, bigint> = {};
    for (const s of j.sealed as { handle: string; epk: string; iv: string; ct: string }[]) {
      const epk = await crypto.subtle.importKey("raw", hexToBytes(s.epk) as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: epk }, kp.privateKey, 256);
      const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("fhish-seal-v1") },
        hk,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(s.iv) as BufferSource }, key, hexToBytes(s.ct) as BufferSource);
      out[s.handle.toLowerCase()] = BigInt(new TextDecoder().decode(pt));
    }
    return out;
  }

  async metrics(): Promise<unknown> {
    return (await fetch(`${this.o.gatewayUrl}/metrics`)).json();
  }
}

export const oracleEventsAbi = parseAbi([
  "event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback)",
  "event DecryptionFulfilled(uint256 indexed requestId, uint256[] cleartexts, bool callbackOk, address via)",
  "function requests(uint256) view returns (address requester, bytes4 callback, bool fulfilled, bytes32 handlesHash)",
]);

/** Resolves when the oracle delivered `requestId` (the KMS callback ran on-chain). */
export async function waitForDecryption(client: PublicClient, oracle: Hex, requestId: bigint, timeoutMs = 120_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = (await client.readContract({ address: oracle, abi: oracleEventsAbi, functionName: "requests", args: [requestId] })) as readonly [Hex, Hex, boolean, Hex];
    if (r[2]) return;
    await new Promise((x) => setTimeout(x, 300));
  }
  throw new Error(`decryption ${requestId} not fulfilled in ${timeoutMs} ms`);
}
