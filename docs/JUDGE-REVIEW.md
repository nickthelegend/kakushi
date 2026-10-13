# Judge review (self-assessed, 13 Oct 2026)

This is scored as an outside Metropolis judge would score it, against the live app at https://kakushi.vercel.app and the evidence in [SUBMISSION](../SUBMISSION.md).

## Scores

| Criterion | Score | Why |
| --- | --- | --- |
| Product quality | 7/10 | The five product screens (Send, Receive, Shield, Confidential, Bridge) are coherent and all hosted. Unfinished parts are labelled "not live" or "awaiting funding", never faked. One minus: older bridge-era pages (Quests, Makers, Explorer) still sit under More and dilute the privacy story. |
| Technical excellence | 9/10 | Two privacy engines, both live on testnet: Noir/UltraHonk proofs verified on chain, and a native tfhe-rs engine with k-of-n input attestation and KMS. A disputable Maker bridge with ZK slashing. Live runs found and fixed real bugs: relayer drain, attester gas burn, stealth gas pricing, Privy zero-fee signing. |
| Monad integration | 8/10 | `monadNewHeads` finality shown live in the app. `eth_sendRawTransactionSync` receipts (431 ms). `txpool_statusByHash`. Gas sized on the billed limit everywhere. Reserve-rule spacing. Finality-gated decryptions and indexing. 100-block log paging. Minus: the UltraHonk verifier costs ~6.2M gas on Monad, which makes gasless withdrawals uneconomic there today. |
| Track fit | 7/10 | "Privacy for any Monad app" fits a payments/infra track well. The bridge half is strong but split across two chains, and only Monad ↔ Sepolia is live. |
| Innovation | 8/10 | Encrypted amounts sent to stealth addresses ("hide who and how much") in one transaction, with private calls out of a shielded pool, is uncommon. The plugin shape (SDK + `<KakushiPay>` + `KakushiConfig`) is the right one for adoption. |

**Bounty view.** Requirements 32/40, technical 27/30, Monad 17/20, innovation 8/10: **84/100**.

## Product-market fit

Wallets and payment apps on Monad need private payouts (payroll, merchants, OTC) without building cryptography themselves. Kakushi sells exactly that, as a component. The open risk is that privacy only works with volume: testnet anonymity sets are tiny, so the honest pitch is the plugin and the tech, not "you are anonymous today".

## Top 5 weaknesses

1. **Gasless on Monad is uneconomic.** ~0.9 MON of gas per withdraw against a 0.1 MON note. The app says so and falls back to self-withdraw. A fix needs a cheaper verifier (batching, recursion) or larger pools.
2. **The attester is not a Chainlink DON.** It runs the CRE workflow logic through the MockKeystoneForwarder. This is clearly labelled, but a CRE judge will discount it.
3. **Thin cross-chain coverage live.** Only Monad ↔ Sepolia is live, Maker 1 caps transfers at 1 USDC, and Base, Arbitrum and OP are "awaiting funding".
4. **Trust in the FHE KMS.** The 2-of-3 signers run in one hosted service today, so the threshold is real in code but not yet in operators.
5. **Partial sponsors.** Envio (offline-tested), Cleanverse (gated) and AUSD (fork-only) are not live.

## What would make a judge say no

- If they read "privacy" as "anonymous today": anonymity sets on testnet are small. *Answer:* the claim is the plugin and the protocol; the docs say so.
- If they demand a production CRE DON. *Answer:* the limit is stated plainly in SUBMISSION.
- If a connected-wallet flow breaks on camera. *Mitigation:* every flow was run live by script on the same contracts and libraries the app uses (see `docs/evidence`).

## Fixed during judge mode

- **Landing overclaim.** The landing named Envio and Cleanverse as "built on" while both are partial; it now names only live integrations.
- **Stale docs.** README and SUBMISSION described a local-only bridge under a deployment hold; they now carry the live evidence.
- **Monad finality.** It is now visible in the product (header pill: Proposed → Finalized ≈ 0.6 s, → Verified ≈ 1.5 s, live).
- **Privy signer.** It signed zero-fee transactions for legacy-priced calls; fixed and proven on chain.
