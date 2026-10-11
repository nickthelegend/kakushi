---
name: kakushi-fhe-operator
description: Run and deploy the Kakushi FHE stack on Monad — the native tfhe-rs engine, coprocessor/gateway/KMS, contract deployment with the CREATE3 registry, Chainlink CRE decryption delivery, and the local end-to-end test. Use when standing up Kakushi locally or on Monad testnet, debugging materialization/decryption, or reading its latency metrics.
---

# Operating Kakushi on Monad

```
client (encrypt) ──► gateway /inputs ──► engine (validate + store)      k-of-n input attestation
contract ──► KakushiExecutor events ──► coprocessor op graph ──► engine (tfhe-rs, native, parallel)
contract ──► KakushiDecryptionOracle.requestDecryption ──► KMS (decrypt, k-of-n EIP-712) ──► fulfill / CRE onReport ──► callback
```

## Components

| Process | Command | Port |
|---|---|---|
| engine (tfhe-rs 1.8.1) | `engine/bin/kakushi-fhe-engine serve --dir .kakushi-fhe --port 8899` (first run generates keys, ~2 s) | 8899 (localhost only) |
| coprocessor + gateway + KMS | `KAKUSHI_FHE_NETWORK=local RPC_URL=… node coprocessor/src/main.ts` | 8890 |
| local CRE runner (NOT a DON; same relay logic as the workflow) | `RPC_URL=… GATEWAY_URL=http://127.0.0.1:8890 node cre/local/runner.ts` | 8891 (`/status`) |
| local fork | `anvil --port 18810 --fork-url https://rpc-testnet.monadinfra.com --prune-history 300` | 18810 |

`.kakushi-fhe/keys/client_key.bin` is the FHE secret key (decryption root). Never commit `.kakushi-fhe/` or `.secrets/`.

## Deploy

```bash
cd contracts
DEPLOYER=<deployer> INPUT_SIGNERS=a,b,c KMS_SIGNERS=x,y,z REGISTRY_SALT=<salt from registry-address.json> \
KAKUSHI_FHE_NETWORK=testnet CRE_FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $DEPLOYER_PK
```
The registry lands at `0xEc4A6767F7884712C0B19ada05F9C98e5fd341E7` only if the deployer and salt match
`contracts/registry-address.json` (CreateX guarded CREATE3).

## Chainlink CRE delivery

`cre/` holds `kakushi-fhe-decrypt-relay`: an EVM log trigger on `DecryptionRequested` plus a cron sweep. It
fetches `GET {gateway}/decryptions/:id` with DON consensus (identical answers), checks `requests` and
`handlesOf` on-chain, then `writeReport`s `abi.encode(requestId, cleartexts, signatures)` to
`KakushiDecryptionOracle.onReport`. The oracle re-verifies the KMS signatures, so CRE adds liveness, not
trust. Set the coprocessor's `DELIVER=cre` to let CRE deliver alone, `both` to race it with the relayer.

```bash
cd cre && node scripts/configure.ts && cre workflow build ./workflows/decrypt-relay
cre login   # once, in a browser
cre workflow simulate ./workflows/decrypt-relay --non-interactive --trigger-index 1 --broadcast -T local-settings
```
The oracle's forwarder is immutable: deploy with `0xB9F7…D192` (MockKeystoneForwarder, what
`simulate --broadcast` uses) or `0xF834…4482` (production, needs a deployed workflow).

## End-to-end check

`node scripts/e2e-local.ts [--deliver cre] [--keep]`: fork + deploy + engine + coprocessor; runs the
auction, confidential USDC and dark OTC flows with real ciphertexts and prints p50/p95 latency. With
`--deliver cre` every callback goes through the forwarder and the run asserts it.

## Metrics

`GET :8890/metrics` → `latencyMs` per op (`op.<opcode>`, `select`, `input`, `kms.decrypt`,
`request_to_callback`, `user_decrypt`) and counts. Publish these; competitors don't.

## Troubleshooting

- `handle … was never materialized`: the coprocessor missed the producing event (check the cursor in
  `.kakushi-fhe/cursor-<network>.json`, RPC limits: Monad allows 100 blocks per `eth_getLogs`).
- Slow ops: the engine uses all cores; lower `KAKUSHI_FHE_CONCURRENCY` if ops contend.
- `request handles mismatch`: a reorg or a forged event source; the KMS refuses to sign.
