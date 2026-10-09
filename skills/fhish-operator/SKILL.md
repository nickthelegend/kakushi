---
name: fhish-operator
description: Run and deploy the Fhish FHE stack on Monad — the native tfhe-rs engine, coprocessor/gateway/KMS, contract deployment with the CREATE3 registry, Chainlink CRE decryption delivery, and the local end-to-end test. Use when standing up Fhish locally or on Monad testnet, debugging materialization/decryption, or reading its latency metrics.
---

# Operating Fhish on Monad

```
client (encrypt) ──► gateway /inputs ──► engine (validate + store)      k-of-n input attestation
contract ──► FhishExecutor events ──► coprocessor op graph ──► engine (tfhe-rs, native, parallel)
contract ──► FhishDecryptionOracle.requestDecryption ──► KMS (decrypt, k-of-n EIP-712) ──► fulfill / CRE onReport ──► callback
```

## Components

| Process | Command | Port |
|---|---|---|
| engine (tfhe-rs 1.8.1) | `engine/bin/fhish-engine serve --dir .fhish --port 8899` (first run generates keys, ~2 s) | 8899 (localhost only) |
| coprocessor + gateway + KMS | `FHISH_NETWORK=local RPC_URL=… node coprocessor/src/main.ts` | 8890 |
| local fork | `anvil --port 18810 --fork-url https://rpc-testnet.monadinfra.com --prune-history 300` | 18810 |

`.fhish/keys/client_key.bin` is the FHE secret key (decryption root). Never commit `.fhish/` or `.secrets/`.

## Deploy

```bash
cd contracts
DEPLOYER=<deployer> INPUT_SIGNERS=a,b,c KMS_SIGNERS=x,y,z REGISTRY_SALT=<salt from registry-address.json> \
FHISH_NETWORK=testnet CRE_FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482 \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $DEPLOYER_PK
```
The registry lands at `0x2152Ed4dD179fCDe7FE0c2F35e274Ce4D7b0BaF9` only if the deployer and salt match
`contracts/registry-address.json` (CreateX guarded CREATE3).

## End-to-end check

`node scripts/e2e-local.ts` — fork + deploy + engine + coprocessor; runs the auction, confidential USDC
and dark OTC flows with real ciphertexts and prints p50/p95 latency.

## Metrics

`GET :8890/metrics` → `latencyMs` per op (`op.<opcode>`, `select`, `input`, `kms.decrypt`,
`request_to_callback`, `user_decrypt`) and counts. Publish these; competitors don't.

## Troubleshooting

- `handle … was never materialized`: the coprocessor missed the producing event (check the cursor in
  `.fhish/cursor-<network>.json`, RPC limits: Monad allows 100 blocks per `eth_getLogs`).
- Slow ops: the engine uses all cores; lower `FHISH_CONCURRENCY` if ops contend.
- `request handles mismatch`: a reorg or a forged event source; the KMS refuses to sign.
