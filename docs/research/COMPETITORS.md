# EVM FHE Competitors: Zama, Fhenix, and others

*Researched 2026-10-09. Sources are linked inline. Items marked **[UNVERIFIED]** could not be confirmed from a primary source.*

## TL;DR

- **Zama Protocol** is the only FHE stack on an EVM mainnet (Ethereum, since late Dec 2025). It is heavyweight: host contracts, 5 coprocessors with majority consensus, an Arbitrum-rollup Gateway, a 13-node MPC KMS in Nitro enclaves, and a relayer. Throughput is about 20 TPS on CPU. Decryption has no published latency, and every reveal is a two-transaction, client-relayed round trip.
- **Fhenix CoFHE** is architecturally similar but simpler: a TaskManager, a queue pipeline, FHEOS, and a Threshold Network. As far as I could find it is **testnet-only** (Ethereum, Arbitrum, and Base Sepolia). It has strong *research* decryption numbers (8.48 ms online phase) but no production latency figures. In July 2026 it acquired Sunscreen, whose SPF **already runs on Monad testnet**.
- Neither stack targets a sub-second chain. Both moved decryption to a client-driven "fetch plaintext + signature, then submit a second tx" pattern. That is the main opening for a Monad-native coprocessor.

---

## 1. Zama Protocol (fhEVM)

### 1.1 Components

| Layer | What it is | Key facts |
|---|---|---|
| Host contracts (on each host chain) | `FHEVMExecutor`, `ACL`, `InputVerifier`, `KMSVerifier`, `HCULimit` | Symbolic execution: an op returns a handle and emits an event, and no FHE runs on the host ([litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper), [host contracts](https://docs.zama.org/protocol/protocol/overview/hostchain)) |
| Coprocessors | TFHE-rs workers | 5 at genesis, majority consensus on the Gateway, staked and slashable. They verify ZKPoKs, execute ops, store ciphertexts (S3-like), replicate ACL events, and run Switch-n-Squash before decryption ([coprocessor](https://docs.zama.org/protocol/protocol/overview/coprocessor)) |
| Gateway | Dedicated **Arbitrum rollup** | Orchestrates input verification, decryption, and bridging, and aggregates the ACLs from each host chain ([gateway](https://docs.zama.org/protocol/protocol/overview/gateway)) |
| KMS | Threshold MPC, **13 nodes**, 2/3 honest, AWS Nitro Enclaves | Keygen, CRS, and threshold decryption. Robust to 1/3 malicious nodes ([litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper), [testnet update](https://www.zama.org/post/zama-protocol-testnet-update-mpc-partners-better-performance-audits-and-new-features)) |
| Relayer + SDK | HTTP relayer, `@zama-fhe/relayer-sdk` | **The relayer SDK was deprecated on 2026-10-08** in favour of the new Zama SDK (`@zama-fhe/sdk`, `@zama-fhe/react-sdk`). Support ends 2026-11-06 ([changelog](https://docs.zama.org/protocol/changelog/zama-protocol-change-log.md), [May 2026 update](https://www.zama.org/post/zama-protocol-update-new-sdk-delegated-decryption-developer-tooling-and-protocol-apps)) |

**Host contract roles** (from [`FHEVMExecutor.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/FHEVMExecutor.sol), [`InputVerifier.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/InputVerifier.sol), and [`HCULimit.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/HCULimit.sol)):
- **FHEVMExecutor**: one function per op. Each op checks the ACL on its operands, derives a handle, marks it "minted" in transient storage, grants `msg.sender` a transient ACL allowance, calls `HCULimit.checkHCUFor<Op>`, and then emits `FheAdd`, `FheMul`, `FheIfThenElse`, `FheRand`, `FheSum`, `FheIsIn`, `FheMulDiv`, and so on.
- **ACL**: `allow`, `allowTransient`, `allowForDecryption`/`makePubliclyDecryptable`, `isAllowed`, plus delegation (v0.10–v0.13 added contract-scoped and time-scoped delegation, and in v0.13 an all-contracts sentinel `0xffff…ffff`).
- **InputVerifier**: checks coprocessor ECDSA signatures over an EIP-712 `CiphertextVerification{ctHandles, userAddress, contractAddress, contractChainId, extraData}`. The threshold is set by the owner. Verified proofs are cached in transient storage per (contract, user, proof).
- **KMSVerifier**: verifies KMS signatures on decryption results. This is what `FHE.checkSignatures` uses.
- **HCULimit** (v0.12): meters "Homomorphic Complexity Units" per tx, per sequential depth (tracked per handle in transient storage), and per block, with a whitelist that bypasses the block cap. **No limits are hardcoded**; the owner sets them at init.

### 1.2 Handle layout (32 bytes, v0.12+)

| Bytes | Field |
|---|---|
| 0–20 | keccak256 prehandle prefix. The preimage is `"FHE_comp"`, op, operands, ACL address, chainId, `blockhash(n-1)`, `block.timestamp` |
| 21 | index (`0xff` = computed; input list index for verified inputs, ≤254) |
| 22–29 | chainId (uint64 BE) |
| 30 | FHE type |
| 31 | handle version |

Source: [`FHEVMExecutor.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/FHEVMExecutor.sol). Zama's docs tell devs to treat handles as opaque ([handles](https://docs.zama.org/protocol/solidity-guides/smart-contract/handles)). Mixing in the blockhash and timestamp means **identical computations in different blocks produce different handles**, so handles are not predictable before inclusion.

### 1.3 Encrypted inputs (ZKPoK)

The client packs all inputs into one compact ciphertext list with a ZKPoK, bound to `(contract, user)` ([inputs](https://docs.zama.org/protocol/solidity-guides/smart-contract/inputs)). Coprocessors verify the proof off-chain via the Gateway and sign the handles. The contract receives `externalEuintX` plus `bytes inputProof` and calls `FHE.fromExternal`, which calls `InputVerifier`. The proof layout is `numHandles | numSigners | handles[32B] | sigs[65B] | extraData`. Older docs mention a **2048-bit** cap per request **[UNVERIFIED for current version]** ([public decryption, older docs](https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer/decryption/public-decryption)). Each ZKPoK verification is a paid Gateway service ($0.50 initially; see fees).

### 1.4 Decryption

- **User decryption**: the user generates a transport keypair (NaCl per docs) and signs an EIP-712 permit (≤10 contracts per permit, default TTL 30 days). The relayer checks the permit, the Gateway checks the ACL, and the KMS threshold-decrypts and re-encrypts shares to the user key. The client combines the shares locally ([permit model](https://docs.zama.org/protocol/sdk/concepts/permit-model)).
- **Public decryption**: `FHE.makePubliclyDecryptable(h)` (tx 1), then off-chain `publicDecrypt` via the relayer returns `{clearValues, abiEncoded, decryptionProof}`, then the app submits tx 2, which calls `FHE.checkSignatures(handles, cleartexts, proof)`. The on-chain decryption oracle and callback (`FHE.requestDecryption`) were **deprecated in v0.9** ([changelog](https://docs.zama.org/protocol/changelog/zama-protocol-change-log.md)). Someone (the user or dApp) must now relay results back.
- **Latency**: **no published end-to-end figure.** The v0.9 testnet update claims 6.6× (public) and 19.2× (user) speedups but gives no absolute numbers ([testnet update](https://www.zama.org/post/zama-protocol-testnet-update-mpc-partners-better-performance-audits-and-new-features)). A third-party report says the first cUSDT mainnet transfer settled "under a minute" ([BlockEden](https://blockeden.xyz/blog/2026/04/02/zama-fhe-fully-homomorphic-encryption-blockchain-privacy-primitive/)). **[UNVERIFIED]**

### 1.5 Limits, performance, and fees

| Metric | Value | Source |
|---|---|---|
| HCU per tx / depth per tx (devnet docs) | 20,000,000 / 5,000,000 | [HCU guide](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu) |
| euint64 add / mul / lt / select / div(scalar) | 162k / 596k / 146k / 55k / 715k HCU | same |
| Implied ceiling | ~30 sequential euint64 adds per tx (an arXiv user hit a ceiling at 23–37 adds) | [bioETH-Beacon](https://arxiv.org/pdf/2606.20315) |
| Throughput, live | ~20 TPS (CPU) | [litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper) |
| GPU target | 500–1,000 TPS/chain by end 2026. **Not live** | [litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper), [The Defiant](https://thedefiant.io/news/infrastructure/zama-ceo-claims-1-000-confidential-transfers-per-second-on-gpus) |
| Fees (USD-priced, paid in $ZAMA) | ZKPoK $0.50 → target $0.005; decryption $0.10 → $0.001; bridging $1 → $0.01. Compute itself is free | [litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper) |
| Example | Confidential transfer = 1 ZKPoK + 3 decryptions ≈ $0.008–$0.80 | same |

### 1.6 ERC-7984

ERC-7984 is the confidential fungible token standard (draft), and OpenZeppelin implements it. Balances are `euint64` handles, `confidentialTransfer(externalEuint64, proof)` or `(euint64)`, **operators with expiry replace allowances**, and `confidentialTransferAndCall` handles callbacks. It is not ERC-20 compatible. Addresses stay public ([EIP-7984](https://eips.ethereum.org/EIPS/eip-7984), [OZ](https://docs.openzeppelin.com/confidential-contracts/api/interfaces)). Zama runs official ERC-20 to ERC-7984 wrappers on mainnet for USDC, USDT, WETH, ZAMA, XAUt, and others ([May 2026 update](https://www.zama.org/post/zama-protocol-update-new-sdk-delegated-decryption-developer-tooling-and-protocol-apps)).

### 1.7 Chains

Ethereum mainnet and Sepolia are confirmed. Multichain coprocessors arrived in v0.12–v0.13; $ZAMA bridges to BNB, Hyperliquid, and Solana. **No Monad deployment or announcement found.** I could not verify which other host chains are live **[UNVERIFIED]**.

---

## 2. Fhenix CoFHE

### 2.1 Architecture

| Component | Role |
|---|---|
| `FHE.sol` + TaskManager (on-chain) | Contracts compose encrypted ops on `ctHash` handles. The TaskManager emits events and enforces the ACL ([what is Fhenix](https://www.fhenix.io/blog/what-is-fhenix)) |
| slimlistener → queues → FHEOS (control plane) → Engine (data plane) → Result Processor | Queue-driven pipeline (Dec 2025 redesign). Inputs that are not ready are requeued; missing ones go to a DLQ. Batches of ~100 ops per worker. Postgres + GCS storage ([architecture update](https://www.fhenix.io/blog/cofhe-architecture)) |
| ZK Verifier | Verifies the input ciphertext + ZK proof and returns a signed attestation. Since SDK 0.7, there is **one signature per batch**, bound to the consuming contract ([cofhesdk llms.txt](https://cofhesdk.fhenix.io/llms.txt), [migration](https://cofhesdk.fhenix.io/migrating-from-cofhejs)) |
| Threshold Network (MPC) | Decryption via a Dispatcher, an MPC ceremony, and TN-DB storage |
| Lifecycle | submitted → validated → queued → executing → completed → published |

### 2.2 Developer API and decryption

- `FHE.sol`: `FHE.add/sub/mul/select/...`, `FHE.allow`, `FHE.allowThis`, `FHE.allowPublic`/`allowGlobal`. The `InEuint*` structs were removed in cofhe-contracts 0.2.x in favour of a per-type `external*` hash plus a shared batch proof ([migration](https://cofhesdk.fhenix.io/migrating-from-cofhejs)).
- **Sealing**: the old `cofhejs` permits held a sealing keypair. CoFHE re-encrypts to the public key and the client unseals ([DEV](https://dev.to/fhenix_io/privacy-isnt-private-by-default-understanding-access-control-in-cofhe-38l0)). In `@cofhe/sdk` (v0.8), permits became **ACPs** that are never auto-generated.
- **`decryptForView`**: UI-only plaintext. The client polls the Threshold Network.
- **`decryptForTx`**: returns `{ctHash, decryptedValue, signature}`. The dApp then submits `FHE.publishDecryptResult` or `FHE.verifyDecryptResult`. The legacy on-chain `FHE.decrypt` + `getDecryptResultSafe` path is flagged for migration ([decryption evolved, Apr 2026](https://www.fhenix.io/blog/decryption-in-cofhe-evolved)). This is the same two-tx pattern as Zama.
- Client proving accounts for **over 90% of `encryptInputs` time** (WASM + rayon) ([cofhesdk llms.txt](https://cofhesdk.fhenix.io/llms.txt)).

### 2.3 Performance and status

| Item | Value |
|---|---|
| Threshold decryption (research, CCS 2025, 4 parties, 1 ms ping, online phase) | 64,319 dec/s, 8.48 ms/op. **Fhenix says this is not production** ([blog](https://www.fhenix.io/blog/unlocking-private-defi-20-000x-throughput-and-37x-lower-latency-in-threshold-fhe-decryption)) |
| Production latency / TPS | **Not published** |
| Chains | Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia. **Mainnet "planned to follow"** ([llms.txt](https://www.fhenix.io/llms.txt); the Base post says Base *Sepolia* ([Base](https://www.fhenix.io/blog/fhenix-adds-base-support-to-cofhe----expanding-privacy-to-ethereum-l2))). Some third-party pages imply mainnet **[UNVERIFIED]** |
| Trust | Early-phase trust assumptions. The EigenLayer AVS model "no longer applies"; decentralization is undated ([what is Fhenix](https://www.fhenix.io/blog/what-is-fhenix)) |
| Roadmap | DBFV (deep arithmetic, ePrint 2025/2321), not stated as deployed. Acquired **Sunscreen** in July 2026 ([Fhenix](https://www.fhenix.io/blog/fhenix-snaps-up-sunscreen-in-a-bid-to-bring-real-privacy-to-ethereum)) |

---

## 3. Other efforts (brief)

| Project | Approach | Status | Relevance |
|---|---|---|---|
| **Inco Lightning** | TEE-based "confidential compute" with an FHE-like Solidity API (`euint`, `ebool`, encrypted randomness). Claims "near-zero added latency" | Live on **Base mainnet** + Sepolia; Solana devnet beta ([docs](https://docs.inco.org/introduction), [Lightning](https://www.inco.org/lightning)) | Fast UX bar, but its trust is TEE hardware, not FHE |
| **Inco Atlas** | FHE + MPC | "Near future", not released ([docs](https://docs.inco.org/introduction)) | — |
| **Sunscreen SPF** | Whole C programs compiled to TFHE (Parasol), a pull-oracle "data bus", threshold committee. Decryption returns "in the subsequent block" | **Testnet on Ethereum Sepolia and Monad** ([SPF intro](https://spf-docs.sunscreen.tech/intro), [arch](https://spf-docs.sunscreen.tech/arch), [FAQ](https://spf-docs.sunscreen.tech/faq)). Now owned by Fhenix | **The only FHE stack found on Monad.** Post-acquisition focus is Ethereum, Arbitrum, and Base, so its Monad future is unclear **[UNVERIFIED]** |
| **Octra** | Proprietary hypergraph FHE (HFHE) on its own L1 | Mainnet alpha Dec 2025 per aggregators. 17k TPS claim is unaudited ([DefiLlama](https://defillama.com/research/spotlight/octra-the-fully-homomorphic-encryption-breakthrough)) | Not EVM-pluggable; non-standard crypto |

---

## 4. Gaps a Monad-native coprocessor ("Fhish") can exploit

Monad context: **300 ms blocks, 600 ms finality** since MIP-12 (2026-07-23), **gas charged on gas limit** with no refunds, 30M per-tx gas, **128 KB contracts** ([Monad blog](https://monad.xyz/blog/300ms-block-times), [differences](https://docs.monad.xyz/developer-essentials/differences)).

### 4.1 Decryption latency and orchestration (biggest gap)

| Problem in Zama / Fhenix | Evidence | Fhish opportunity |
|---|---|---|
| Reveals take **two txs plus a client relay**: mark decryptable, then off-chain fetch, then submit proof. The on-chain oracle callback was removed (Zama v0.9; Fhenix moved to `decryptForTx`) | [Zama changelog](https://docs.zama.org/protocol/changelog/zama-protocol-change-log.md), [Fhenix](https://www.fhenix.io/blog/decryption-in-cofhe-evolved) | **Coprocessor-driven auto-fulfilment**: the network posts the signed plaintext and calls back automatically within N blocks, so no dApp babysitting is needed. Keep the self-relay path as a fallback |
| Zama's decryption path is host → coprocessors → **Arbitrum Gateway** → 13-node MPC in Nitro → relayer → client → host. There are no published latency numbers; anecdotally it is tens of seconds | [gateway](https://docs.zama.org/protocol/protocol/overview/gateway), [BlockEden](https://blockeden.xyz/blog/2026/04/02/zama-fhe-fully-homomorphic-encryption-blockchain-privacy-primitive/) | No separate gateway chain. Use **Monad itself as the coordination layer** (600 ms finality beats an Arbitrum hop). Publish p50/p95 "request → plaintext on-chain" as a first-class metric. Target low single-digit seconds |
| Fhenix's 8.48 ms is a research online-phase number, not end-to-end | [Fhenix blog](https://www.fhenix.io/blog/unlocking-private-defi-20-000x-throughput-and-37x-lower-latency-in-threshold-fhe-decryption) | Honest, reproducible end-to-end benchmarks are themselves a differentiator |

### 4.2 Throughput vs a 300 ms chain

Zama runs about 20 TPS live, with GPU not live ([litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper)). A Monad block every 300 ms means even 20 FHE tx/s is fewer than 6 per block. **Design for GPU from day 1, and pipeline by handle dependency.** Monad's parallel execution produces many independent tx DAGs, and the coprocessor should exploit that explicitly with a per-handle dependency scheduler, which Fhenix only approximates with requeueing. Expose a per-block HCU budget, as Zama's `HCULimit` does, so the coprocessor never falls unboundedly behind.

### 4.3 Gas on Monad (charged on limit)

- Zama op calls do ACL `SSTORE`s, transient allowance writes, HCU metering (with per-block storage writes `usedBlockHCU`), and events, so every op costs real gas ([`HCULimit.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/HCULimit.sol)). On Monad, users pay for the **gas limit**, so over-estimated FHE-heavy txs are pure waste.
- **Opportunity**: deterministic, tight gas per op (a published gas table plus an SDK estimator), event-only symbolic ops where possible, and ACL that is transient by default with batched persistent grants. Monad's 128 KB contract limit lets a single executor/library hold all ops without proxy splitting.
- Avoid a per-block HCU `SSTORE` on a hot shared slot. It serializes otherwise-parallel txs under Monad's optimistic execution (inference from Monad's parallel model; not measured).

### 4.4 Developer ergonomics and pluggability

| Pain point | Evidence | Opportunity |
|---|---|---|
| Constant churn: Zama's relayer SDK was deprecated after about 1 year (2026-10-08) and the handle format broke in v0.12. Fhenix replaced `cofhejs` with `@cofhe/sdk`, removed `InEuint`, and renamed permits to ACPs | [Zama changelog](https://docs.zama.org/protocol/changelog/zama-protocol-change-log.md), [Fhenix migration](https://cofhesdk.fhenix.io/migrating-from-cofhejs) | Commit to a stable ABI. Make the Solidity API **source-compatible with Zama's `FHE.sol`** (`euint64`, `externalEuint64`, `FHE.fromExternal`, `allow`/`allowThis`, `makePubliclyDecryptable`, `checkSignatures`) so ERC-7984/OZ confidential contracts port unchanged |
| HCU depth caps (~30 sequential euint64 adds per tx) force devs to split logic across txs | [HCU guide](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu), [arXiv](https://arxiv.org/pdf/2606.20315) | Higher, documented per-tx budgets. Cheap multi-tx chaining is natural at 300 ms blocks; provide `FHE.sum`-style batched ops |
| Zama handles include blockhash and timestamp, so they can't be precomputed client-side | [`FHEVMExecutor.sol`](https://raw.githubusercontent.com/zama-ai/fhevm/main/host-contracts/contracts/FHEVMExecutor.sol) | Deterministic handles (from tx hash + op index) make optimistic UIs and pre-subscription to results easy |
| Client-side ZK proving is over 90% of encrypt time (Fhenix) | [cofhesdk](https://cofhesdk.fhenix.io/llms.txt) | Fast WASM/WebGPU proving, or an optional proof-delegation service |
| Existing ERC-20 contracts can't use FHE without a rewrite | ERC-7984 is not ERC-20 compliant ([EIP](https://eips.ethereum.org/EIPS/eip-7984)) | Ship ERC-20 ↔ ERC-7984 wrappers plus adapters (vault, AMM, auction) on Monad from launch |

### 4.5 Cost model

Zama charges USD-priced fees in $ZAMA ($0.10 per decryption and $0.50 per ZKPoK initially), and a transfer needs 3 decryptions ([litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper)). That is heavy for high-frequency Monad apps. **Opportunity**: price in MON or stablecoins with no extra token, bundle "decrypt own balance" into a cheap or free view path, and amortize ZKPoK verification across batched inputs, as Fhenix does with one signature per batch.

### 4.6 Trust and decentralization

Zama runs 13 MPC nodes in Nitro + 5 coprocessors, governance slashing, and is audited. Fhenix has "early-phase trust assumptions" with no dated decentralization. A new entrant will start *less* decentralized than Zama, so it should be explicit about this: publish its trust stages (cf. Fhenix's Privacy Stages framework), make coprocessor outputs re-executable and verifiable, and keep the KMS threshold configurable.

---

## 5. Could not verify

- Absolute Zama user or public decryption latency (no official figure).
- The current Zama per-input bit cap (2048 bits is from older docs) and mainnet HCU limit values (the docs show devnet values only).
- Zama host chains beyond Ethereum.
- Whether any CoFHE deployment is on mainnet.
- Fhenix's production FHE scheme (TFHE vs DBFV in production).
- Inco Lightning's TEE type and decryption latency.
- Octra performance claims.
- Whether Sunscreen SPF remains on Monad testnet after the acquisition.
