---
name: kakushi-fhe-sdk
description: Integrate a frontend or Node service with Kakushi on Monad using @kakushi/fhe-sdk — encrypt inputs for FHE.fromExternal, user-decrypt encrypted balances with an EIP-712 signature, and wait for public decryption callbacks. Use when building a dApp UI or bot that talks to Kakushi confidential contracts.
---

# @kakushi/fhe-sdk

```ts
import { KakushiFheClient, waitForDecryption } from "@kakushi/fhe-sdk";
import { wasmEncryptor } from "@kakushi/fhe-sdk/browser";   // Zama tfhe 1.8.1 WASM in the browser
// import { nodeTfheEncryptor } from "@kakushi/fhe-sdk/node"; // Node, pure JS (Zama node-tfhe), ~40 ms, no binary
// import { nativeEncryptor } from "@kakushi/fhe-sdk/node";   // kakushi-fhe-engine CLI in Node (native speed)

const fhe = new KakushiFheClient({ gatewayUrl: "https://gateway.kakushi.xyz", chainId: 10143, encryptor: wasmEncryptor() });
```

## Encrypt an input

```ts
const { handle, proof } = await fhe.encrypt("euint64", 1337n, auctionAddress, userAddress);
await walletClient.writeContract({ address: auctionAddress, abi, functionName: "bid", args: [handle, proof], gas: 3_000_000n });
```
The value is encrypted on the user's device under the network public key. The gateway checks the
ciphertext is well-formed and returns a k-of-n attestation bound to (handle, user, contract): it is
useless to anyone else and in any other contract. `user` must be the account that sends the tx.

## Read your own encrypted value

```ts
const h = await publicClient.readContract({ address: token, abi, functionName: "confidentialBalanceOf", args: [me] });
const values = await fhe.userDecrypt([h], token, walletClient);   // one EIP-712 signature
// any other signer (MetaMask Agent Wallet, a KMS, a smart account):
// await fhe.userDecryptWith([h], token, user, (typedData) => mySigner.signTypedData(typedData));
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

## App ABIs

`import { auctionAbi, cusdcAbi, otcAbi } from "@kakushi/fhe-sdk/apps"`: the ready-made sealed auction,
confidential ERC-20 wrapper and dark OTC desk. For an agent CLI, see `plugins/mm-kakushi` (MetaMask
Agent Wallet plugin).
