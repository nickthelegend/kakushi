# Sponsor coverage

Status as of 13 Oct 2026. **Working** means a real call or transaction, exercised by a script or the live app, with the evidence linked. **Partial** means the code exists and is tested offline or on a fork, but a live piece is missing. **Not used** says why.

**Count:** 6 working, 3 partial, the rest not used.

## Working

| Sponsor | What Kakushi uses it for | Live evidence (Monad testnet 10143 unless noted) |
| --- | --- | --- |
| **Chainlink CRE** | Attestation windows: the payout and source logs of every chain, as sorted Poseidon2 roots, are written to the hub's `AttestationOracle` through Chainlink's `MockKeystoneForwarder` (`0xB9F7…D192`). This is the `cre workflow simulate --broadcast` path. Dispute proofs are checked against these windows. The CRE workflow source is in `packages/cre/workflows`. The hosted runner executes the same `attest-core` logic and is labelled as not a DON. | Hosted attester on Railway, 10 Monad windows and 2 Sepolia windows. For example `0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8`, 10,000 blocks in one report, 324,857 gas. |
| **Privy** | (1) Wallet login in the app: email, Google or any wallet. (2) The Maker's hot key as a Privy **server wallet fenced by a policy**. The policy is default-deny: fill and refund on the PayoutRouter, `answerDispute`, and approvals to the PayoutRouter or MDC only, on chains 10143 and 11155111 only. It is built and updated by `packages/maker/scripts/privy-setup.ts`. | `scripts/privy-proof-testnet.ts`: Privy signed `USDC.approve(PayoutRouter)` and it landed (`0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4`). Privy refused `USDC.transfer` to an outside address ("policy violation"). Evidence: [testnet-privy.json](evidence/testnet-privy.json). |
| **BlockVision (MonadVision)** | Every contract is verified through MonadVision's Sourcify endpoint (`scripts/verify-testnet.ts`), so the explorer shows the source. | 29/29 Monad contracts verified (Sourcify exact or bytecode match). Sepolia is 15/15 on sourcify.dev. |
| **Circle USDC (canonical, Monad testnet)** | The bridge asset, the 1-USDC shielded pool and the token under cUSDC. | Bridge 0.5 USDC Monad → Sepolia `0x2db2e050…` → payout `0x11b85b3e…` (27.4 s). Bridge 0.3 USDC Sepolia → Monad `0x65e30e33…` → payout `0x7bd85700…` (11.3 s). Wrap into cUSDC (see FHE below). |
| **Envio HyperSync** | The Receive inbox reads every stealth announcement from HyperSync (`/api/announcements`, server-side token, only Kakushi's announcer), then reads only newer blocks over RPC. Monad's RPC caps `eth_getLogs` at 100 blocks, so a scan over the chain's history was minutes long; it never finished in the demo recording. The HyperIndex package (`packages/indexer/envio`, `fhe/indexer`) is built and tested offline. | Live: a full scan of 350,352 Monad blocks in 1.3 s via `kakushi.vercel.app/api/announcements` (10 announcements). The HyperIndex package is not deployed to Envio Cloud. |
| **Monad-native RPC** (`eth_sendRawTransactionSync`, `monadNewHeads`, `txpool_statusByHash`) | Smoke tests and the app: synchronous receipts, the commit-state timeline, and a live finality readout in the app's header pill. | Stealth send `0x7181caa5…`: receipt 431 ms, Proposed 431 / Voted 725 / Finalized 1020 / Verified 1933 ms, txpool "tracked" ([testnet-smoke-stealth.json](evidence/testnet-smoke-stealth.json)). |

## Partial

| Sponsor | What exists | What is missing |
| --- | --- | --- |
| **Agora AUSD** | `cAUSD` (`0x21503258…4c77`) is deployed on testnet over the real AUSD `0xa9012a05…22dC`. The FHE flows (wrap, encrypted pay, pay links, encrypted requests, cash out) are tested on real AUSD on a Monad fork (`fhe/` e2e and mobile `verify-fork` 16/16). | No live testnet AUSD transaction yet: the deployer holds no AUSD. The live FHE run used cUSDC. |
| **Chainlink Data Feeds** | The EBC prices native-coin lanes from the ETH/USD feed `0x5c8c8482…6d31` (margin = max × price × haircut × k). The deploy script reads it live to size Maker margin. | No native lane is registered on testnet: maker2's ETH lane is unfunded. |
| **Cleanverse** | PayoutRouter has an optional compliant-token gate with local validator tests ([CLEANVERSE-INTEGRATION](CLEANVERSE-INTEGRATION.md)). | The canonical validator ABI and A-Pass onboarding need the sponsor. |

## Not used

| Sponsor | Why |
| --- | --- |
| Kuru, Perpl | Kakushi does not trade. Its own shielded pools are not order books. |
| MetaMask (Agent Wallet / Smart Accounts) | The `mm kakushi` plugin and skills are in `fhe/plugins` and `fhe/skills`, but they are not wired into this app. |
| Zerion, Nansen, Dynamic | Not needed: wallet login is Privy, and portfolio data would leak exactly what Kakushi hides. |
| Alchemy, QuickNode, Chainstack, Dwellir, Spectrum, Tenderly | Kakushi runs on the public Monad RPC. Any of these is a drop-in `MONAD_TESTNET_RPC_URL`. |
| Kimi, Qwen, Tencent Hunyuan | No AI features. |
| Aurora Intents, Mercuryo | Mainnet only. |
| Mera | It is used in the FHE mobile app (`fhe/mobile`, passkeys), which is not part of the hosted web demo. |

## Monad-native items

| Item | Where |
| --- | --- |
| Commit-state timeline (`monadNewHeads`: Proposed → Voted → Finalized → Verified) | `@kakushi/fhe-sdk/monad` `MonadHeads`; the app's header pill; `scripts/smoke-testnet.ts` |
| Synchronous receipts (`eth_sendRawTransactionSync`) | `sendRawSync`, smoke tests (receipts in 431–632 ms) |
| txpool status (`txpool_statusByHash`) | smoke evidence, "tracked" |
| Gas billed on the limit | Every sender uses estimate + 15% (or + 30% for FHE). The relayer refuses fees below gas. The attester went from a flat 1.5M to its estimate. Stealth gas is priced live. |
| Reserve balance rule | Value sends are spaced ≥ 3 blocks (watchtower, smoke tests, FHE e2e). Deploys send no MON value. |
| 100-block `eth_getLogs` cap | Paged everywhere: indexer, attester, `findPayout`, the Merkle tree rebuild. |
| Finality gating | The indexer reads at `finalized`. KMS decryptions wait for `finalized` (`DECRYPT_AT=finalized`). |
| Canonical contracts | CreateX (CREATE2/CREATE3), Chainlink `MockKeystoneForwarder`, Circle USDC, Agora AUSD, the Chainlink ETH/USD feed |
