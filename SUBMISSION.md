# Monad Metropolis submission (draft, not submitted)

| | |
|---|---|
| Project | **Fhish**: plug-and-play FHE for any Solidity contract on Monad |
| Track | **T1 Onchain Finance & Trading** |
| Bounties | **Chainlink: Best workflow with CRE** ($3k, all tracks) |
| Team | solo, from a spare account (see USER_ACTION_REQUIRED in the hand-off) |
| Repo | to be pushed public, MIT (DEPLOY-LATER.md §5) |
| Live app | held until testnet go (DEPLOY-LATER.md §4) |
| Deadline | Tue 2026-10-13 23:59 ET |

## Pitch (≤ 2 min)

On-chain finance leaks everything: every bid, balance, limit price and liquidation level is public,
so it gets front-run and copied. Fully homomorphic encryption fixes that by letting a contract compute
on numbers it cannot read. Today it is either Zama on Ethereum (heavy: gateway rollup, client-relayed
two-transaction reveals) or testnets.

**Fhish brings FHE to Monad as a two-line integration.** Inherit `FhishConfig`, call `FHE.add`,
`FHE.gt`, `FHE.select`. The API is Zama-compatible, so existing confidential contracts port. Under the
hood, real Zama tfhe-rs ciphertexts are computed by a parallel coprocessor that follows Monad's
300 ms blocks. Reveals come back **automatically as a callback**, delivered by **Chainlink CRE**,
with the KMS signatures checked on-chain. Zama and Fhenix both removed that callback.

What we show: a sealed-bid auction where losing bids are never decrypted, confidential USDC that
wraps real Monad testnet USDC, and a dark OTC desk where a missed order reveals nothing at all.

## Main-track scoring map

| Criterion (20% each) | Evidence |
|---|---|
| Product quality | Landing + playground with real in-browser encryption (WASM, multi-threaded); every playground flow verified in Chrome |
| Technical excellence | Native tfhe-rs engine, dependency-aware parallel op graph, transient ACL (EIP-1153), k-of-n input and KMS signatures, sealed user decryption (P-256 ECDH + AES-GCM), CREATE3 same-address registry; 12 Solidity tests, CRE unit tests, e2e |
| Monad integration | Designed for gas-on-limit (event-only ops, tight explicit limits), `eth_getLogs` ≤ 100 blocks, 300 ms blocks; wraps Circle USDC on Monad testnet; CRE forwarder on Monad testnet |
| Track fit (T1) | Confidential trading primitives: sealed auctions, confidential stablecoin, dark OTC with encrypted limits |
| Innovation | Automatic FHE decryption callbacks via CRE, published end-to-end latency, one-line pluggability |

## Chainlink CRE bounty

**Requirement:** "Build, simulate, or deploy a CRE workflow used as an orchestration layer within
your project." CLI simulation accepted; the receiver must be implemented correctly.

| Requirement | Where |
|---|---|
| CRE workflow (TS → WASM) | `cre/src/workflow.ts`, `cre/workflows/decrypt-relay/` (`cre workflow build` compiles it: done) |
| Orchestration role | It is Fhish's decryption delivery layer: log trigger per `DecryptionRequested` + cron sweep → HTTP fetch of the KMS-signed result with DON consensus (identical aggregation) → EVM reads (`requests`, `handlesOf`) → `writeReport` |
| Receiver | `FhishDecryptionOracle.onReport` (`contracts/src/oracle/`): only the forwarder, ERC-165 `IReceiver`, re-verifies k-of-n KMS EIP-712 signatures, then calls the app back |
| Evidence so far | Local fork: 4/4 callbacks delivered through Chainlink's MockKeystoneForwarder (`0xB9F7…D192`, cloned from Monad testnet) by the local runner that executes the same core logic (`cre/local/runner.ts`, labelled NOT a DON) |
| Still needed (owner) | `cre login`, then `cre workflow simulate … --broadcast -T staging-settings` on Monad testnet for a real simulation tx (DEPLOY-LATER.md §3) |

## Demo video script (≤ 3 min)

| Time | Shot |
|---|---|
| 0:00 | Landing: type a number, watch it become 16 KB of ciphertext in the browser |
| 0:20 | The two-line integration on the Developers page |
| 0:35 | Playground, Alice: place a sealed bid. Show the chain holds a handle, not the number |
| 0:55 | "Decrypt my bid": sealed to this tab only |
| 1:10 | Bob and Carol bid; close: winner and price arrive by callback; losing bids stay encrypted |
| 1:40 | Confidential USDC: wrap real USDC, send privately, reveal my balance, unwrap through the oracle |
| 2:10 | Dark OTC: a miss reveals nothing, a cross reveals only the maker's price |
| 2:30 | Live metrics: p50/p95 per FHE op, KMS decrypt, request → callback; CRE runner status |
| 2:45 | Terminal: `pnpm e2e --deliver cre` → 4 × PASS |

## Limitations to state in the submission

- Local fork only until the owner funds the deployer and says go; no public tx hashes yet.
- The local CRE runner is not a DON; the real `cre workflow simulate` needs `cre login`.
- One engine holds the FHE secret key; KMS keys run in one process locally (see README, Trust model).
- tfhe-rs commercial use needs Zama's patent license (README, License).
