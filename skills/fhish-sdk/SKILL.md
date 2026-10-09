---
name: fhish-sdk
description: Integrate a frontend or Node service with Fhish on Monad using @fhish/sdk — encrypt inputs for FHE.fromExternal, user-decrypt encrypted balances with an EIP-712 signature, and wait for public decryption callbacks. Use when building a dApp UI or bot that talks to Fhish confidential contracts.
---

# @fhish/sdk

```ts
import { FhishClient, waitForDecryption } from "@fhish/sdk";
import { wasmEncryptor } from "@fhish/sdk/browser";   // Zama tfhe 1.8.1 WASM in the browser
// import { nativeEncryptor } from "@fhish/sdk/node";   // fhish-engine CLI in Node (native speed)

const fhish = new FhishClient({ gatewayUrl: "https://gateway.fhish.xyz", chainId: 10143, encryptor: wasmEncryptor() });
```

## Encrypt an input

```ts
const { handle, proof } = await fhish.encrypt("euint64", 1337n, auctionAddress, userAddress);
await walletClient.writeContract({ address: auctionAddress, abi, functionName: "bid", args: [handle, proof], gas: 3_000_000n });
```
The value is encrypted on the user's device under the network public key. The gateway checks the
ciphertext is well-formed and returns a k-of-n attestation bound to (handle, user, contract): it is
useless to anyone else and in any other contract. `user` must be the account that sends the tx.

## Read your own encrypted value

```ts
const h = await publicClient.readContract({ address: token, abi, functionName: "confidentialBalanceOf", args: [me] });
const values = await fhish.userDecrypt([h], token, walletClient);   // one EIP-712 signature
values[h.toLowerCase()];   // bigint
```
The gateway checks the on-chain ACL (you AND the contract must be allowed), then seals each value to a
fresh P-256 key generated in your browser (ECDH + AES-GCM). Nothing travels in plaintext.

## Public decryption (reveals)

Contracts call `FHE.requestDecryption`; the KMS answers on-chain automatically. In the client just
wait: `await waitForDecryption(publicClient, oracleAddress, requestId)` then read the contract's
revealed fields (e.g. `winner()`, `price()`).

## Browser setup

- Multi-threaded WASM needs cross-origin isolation: serve with
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
  (`credentialless` works too). Without it encryption still works, single-threaded.
- Load the encryptor lazily (it pulls a ~5 MB WASM).

## Errors you will see

| Error | Meaning |
|---|---|
| `gateway: not allowed to decrypt 0x…` | the contract never `FHE.allow`ed that handle to you |
| `NotAllowed(handle, contract)` on-chain | the contract forgot `FHE.allowThis` after an update |
| `ThresholdNotMet` | input proof for a different user/contract, or tampered |
| `authorization expired` | re-sign; default TTL 300 s |
