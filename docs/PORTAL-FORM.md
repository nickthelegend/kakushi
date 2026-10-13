# Portal form: Kakushi

The fields below are in the order of hackathon.monad.xyz → "Complete your entry". Paste each block as it is. Lines marked **[user]** are yours to fill in.

---

## 1. Primary track

Track 04: Trust, Identity & AI Infrastructure

## 2. Logo

`docs/brand/logo-portal.png` (1000×1000 PNG, 42 KB)

## 3. Project name (≤ 120)

Kakushi

## 4. Tagline (≤ 200)

The privacy provider for Monad: ZK hides who, FHE hides how much. Stealth payments, a shielded pool, encrypted amounts and a private bridge that any app can add.

## 5. Description (≤ 8,000)

PROBLEM
Every payment on Monad is public: who paid whom, and how much. Payroll, merchant payouts, OTC deals and any app that pays its users leak their whole history to anyone with an explorer. The privacy tools that exist (Umbra-style stealth addresses, mixer pools, FHE) each solve one piece, and an app team would have to build and audit the cryptography itself.

SOLUTION
Kakushi is a privacy plugin for Monad with two engines:
- ZK hides who.
  - Stealth addresses (ERC-5564/6538): pay a wallet, and the money lands at a one-time address that only the recipient can find and spend.
  - A shielded pool for any token, from a permissionless factory: deposit, then withdraw to a fresh address with a Noir/UltraHonk zero-knowledge proof. A relayer can pay the gas, or the withdrawal can call any contract privately, with the call bound by the proof.
- FHE hides how much. Balances and payments are ciphertexts, on a native tfhe-rs engine with k-of-n input attestation and KMS. The gateway releases a decryption only to its owner (sealed to their browser tab) or as a KMS-signed public value. Any contract becomes confidential with `contract MyApp is KakushiConfig` and the Zama-compatible `FHE.*` API.
- Both at once: an encrypted amount sent to a one-time stealth address, in one transaction.
- Cross-chain: a Maker bridge between Monad and Sepolia. Makers are bonded with margin on Monad. Chainlink CRE workflow logic attests every chain's payouts, so a Maker that doesn't pay can be proven unpaid with a ZK proof and slashed.

Developers get @kakushi/sdk, @kakushi/fhe-sdk and a drop-in <KakushiPay> React widget. The app (Send, Receive, Shield, Confidential, Bridge) is the reference integration.

WHY MONAD
Private payments need fast, final settlement. On Monad, a stealth payment's receipt arrived in 431 ms (eth_sendRawTransactionSync) and was Finalized 1,020 ms after sending. The app shows live finality from monadNewHeads in its header (Proposed → Finalized ≈ 0.6 s). FHE decryptions wait for `finalized`, so a revealed amount can never be reorged away. Every sender sizes gas on the billed limit and respects Monad's reserve-balance rule, and all log reads page Monad's 100-block eth_getLogs cap.

WHAT'S LIVE (Monad testnet 10143 + Ethereum Sepolia; all hosted, all exercised with real transactions)
- Stealth send + scan: receipt 431 ms; Proposed 431 / Voted 725 / Finalized 1020 / Verified 1933 ms.
- Shielded pool: the UltraHonk verifier runs on Monad. On Sepolia, a gasless withdraw through the relayer paid a never-funded address.
- Confidential (FHE), 8/8: wrap, encrypted pay to a stealth address, scan, stealth-key decrypt, move, encrypted pay, KMS cash-out, pay link. Every transaction hash is in docs/evidence/testnet-fhe.json.
- Bridge in both directions through a hosted Maker: 11.3 s Sepolia→Monad, 23 s Monad→Sepolia. Private delivery to a one-time stealth address also ran live: 0.44955 USDC 11 s after the source (0x77ebad1437d992a60d354ac04d10cc993906f7b9cb5b2a45ec73fca311b4be06, Sepolia).
- Envio HyperSync powers the Receive inbox: a full scan of 350,352 Monad blocks in 1.3 s, where paging Monad's 100-block eth_getLogs took many minutes.
- Chainlink CRE: attestation windows on the hub, and a `cre workflow simulate` run against live testnet state.
- Privy: a policy-fenced server wallet signs an allowed approval, which lands on chain, and is refused a transfer out.
- 44 contracts verified on Sourcify / MonadVision.
- Team-seeded activity, for the demo: 5 team wallets shielded 0.1 MON each in the Monad pool (an anonymity set of 6), 2 notes were withdrawn by the relayer to brand-new addresses, and 1 stealth payment was made. These are our wallets, not organic users (docs/evidence/seed-13oct.md).

Honest limits:
- The hosted attester runs the CRE workflow logic through Chainlink's MockKeystoneForwarder. It is not a DON.
- One hosted engine holds the FHE key, and the 2-of-3 KMS signers run in one service.
- Slashing has run end to end on a local fork. No bridge transfer has gone unpaid on testnet.
- An UltraHonk withdraw costs ~6.2M gas on Monad (0.698 MON), so gasless pays off on Sepolia today.
- Base, Arbitrum and OP Sepolia spokes are built but awaiting funding.

## 6. First users and how we reach them (≤ 8,000)

FIRST USERS
1. Monad payment and payroll apps that pay people on chain: contractors, creators, payroll. They need salaries and payouts that aren't public, and they can't build ZK or FHE themselves. Kakushi gives them encrypted amounts (cUSDC/cAUSD) and stealth payouts behind one SDK call.
2. Wallets on Monad. They can add "receive privately" (a stealth meta-address registered with one signature) and an inbox that finds incoming private payments, by embedding the SDK.
3. Merchants and OTC desks that settle in USDC and don't want their volumes and counterparties readable on an explorer. They would use shielded pools and private calls into their existing contracts.
4. Cross-chain users moving USDC into Monad who don't want their Monad address tied to their source-chain history: private delivery over the Maker bridge.

HOW WE REACH THEM
- Go to builders first. Kakushi is a plugin, so the first customers are Monad app teams, not end users: hackathon and ecosystem teams, Monad developer channels, and direct outreach to wallet and payroll teams with the three-line <KakushiPay> integration.
- Make adoption a copy-paste: the widget, the SDK, `KakushiConfig` for confidential contracts, and a permissionless pool factory, so a team can make its own token private without asking us.
- Show it working: a live app on testnet with public evidence (every claim backed by a transaction), which teams can try before they integrate.
- Grow the anonymity set, which is what makes privacy real. Each integrated app adds deposits to the shared pools, so every new app makes every other app's users more private.
- After the hackathon: audits of the circuits and contracts; splitting the FHE KMS across independent operators; a production Chainlink CRE workflow on a DON; and a cheaper withdraw verifier, so gasless works on Monad.

## 7. Repository URL

https://github.com/nickthelegend/kakushi

## 8. Live app URL (Monad testnet)

https://kakushi.vercel.app

## 9. Demo video (≤ 3:00, the working product)

Upload: `/Volumes/Extreme SSD/Projects/kakushi/docs/demo/kakushi-demo.mp4` (2:53, 1920×1080, captions burned in plus `kakushi-demo.srt`; live footage on Monad testnet and Sepolia)
**[user]** The portal takes a link: upload it to YouTube or Loom (unlisted is fine) and paste the URL here.

## 10. Pitch video (≤ 2:00)

Upload: `/Volumes/Extreme SSD/Projects/kakushi/docs/demo/kakushi-pitch.mp4` (1:20)
**[user]** Upload and paste the link.
Team: **[user fills in]**

## 11. Testing instructions for judges (≤ 8,000)

NO LOGIN NEEDED TO LOOK AROUND
Open https://kakushi.vercel.app. The landing page, Plugin (developer page), Explorer, Makers, Attestations and Claim pages all read live testnet data without a wallet. The header pill shows Monad's live finality (from monadNewHeads).

NETWORK
- Monad testnet (chain 10143) is the hub.
- Ethereum Sepolia (11155111) is the bridge spoke and has a cheap gasless pool.
- Base, Arbitrum and OP Sepolia are shown as "Awaiting funding" and can't be selected.

TO TRANSACT
1. Click Connect (top right) and sign in with Privy (email or Google) or any browser wallet. Use Monad testnet.
2. Get testnet MON from the Monad faucet and testnet USDC from Circle's faucet (Monad testnet). The bridge and FHE flows use USDC.
3. Receive: click Register once (one signature derives your stealth keys and registers your meta-address).
4. Send: paste a wallet that has registered (or its st:eth: meta-address), send 0.01 MON, then open Receive → Scan to find it.
5. Confidential: on the Balance tab, enter 1 USDC → Make private → Reveal. On Pay → Private recipient, paste a registered wallet and Pay privately. The recipient's Receive inbox shows "Encrypted · Reveal" → Reveal → Move to balance. Cash out returns USDC; only that amount is ever revealed.
6. Shield: deposit into a pool, save the note, then use Withdraw with the note to a fresh address. On Sepolia, tick "Gasless via relayer" (the relayer pays the gas and takes 10%).
7. Bridge: Monad ↔ Sepolia USDC, 0.1–1 USDC (Maker 1's limits). "Deliver privately" sends to a stealth address. It takes about 15–30 s (Sepolia block times).

NOTES AND CAPS
- Maker 1 takes 0.1–1 USDC per transfer. The app names the range if you go outside it.
- Gasless isn't offered on the Monad pool: the ZK withdraw costs more gas (~0.7 MON) than the 0.1 MON note. Use Sepolia for gasless.
- FHE reveals are sealed to your browser tab and wait for Monad finality. The first encryption in a tab takes a few seconds (WASM).
- Attestations: busy ranges are attested within a minute; quiet ranges are batched every 2 h to save gas.
- Everything a judge might doubt is in SUBMISSION.md → "Limits" and docs/JUDGE-ROUND-2.md.

## 12. Bounties

### Privy ($5,000, all tracks)

**How does your project use Privy beyond authentication?**
Privy is the app's login (email, Google or any wallet). Beyond login, a bridge Maker can hold its hot key as a Privy server wallet fenced by a default-deny policy (the Maker's `privy` signer, packages/maker/src/signer.ts). The policy allows only:
- fill and refund on Kakushi's PayoutRouter;
- answerDispute;
- approvals to the PayoutRouter or MDC;

and only on chains 10143 and 11155111. packages/maker/scripts/privy-setup.ts builds it and updates it in place (`--update-policy`). A compromised Maker host cannot move inventory or margin anywhere else. Privy features used: embedded and external-wallet login, server wallets, and the policy engine.

**Evidence**
- Privy signed USDC.approve(PayoutRouter) from the policy wallet, and it landed: 0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4 (Monad testnet).
- Privy refused USDC.transfer to an outside address ("policy violation"). A refusal never reaches the chain, so its evidence is the script output: scripts/privy-proof-testnet.ts, docs/evidence/testnet-privy.json.
- Honest note: the live Maker 1 still runs a local key. The Privy wallet proves the policy separately.

### Chainlink CRE ($3,000, all tracks)

**How is a CRE workflow used as an orchestration layer?**
The CRE workflows in packages/cre/workflows (attest-monad, attest-sepolia, source-native, built with @chainlink/cre-sdk: cron trigger, EVM reads, log filters, writeReport) attest every chain's Maker payouts and source payments. They write them as sorted Poseidon2 window roots to the hub's AttestationOracle, with contiguous payout windows. Kakushi's dispute circuit (Noir) proves a payout missing against those roots, so CRE is the bridge's source of truth for what happened on other chains.

**Evidence**
- `cre workflow simulate` (CRE CLI v1.36.0) against live testnet state: the compiled workflow read the hub and computed the next contiguous Sepolia window (docs/evidence/cre-simulate-attest-sepolia-testnet.txt).
- On chain: a hosted runner executes the same attest-core logic and delivers through Chainlink's MockKeystoneForwarder (0xB9F79d863261869B234c481D1f9A7af84AeAd192). One example window, 10,000 Monad blocks in one report: 0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8.
- Honest note: the mock forwarder checks no signatures, so attestations are trusted from Kakushi's runner. This is not a deployed DON workflow.

### Envio ($1,000, all tracks)

**How do you use Envio?**
Kakushi's Receive inbox finds a user's stealth payments by matching every ERC-5564 announcement against their viewing key. On Monad the public RPC caps eth_getLogs at 100 blocks, so a scan over the chain's history meant thousands of sequential requests and never finished in our demo recording. The inbox now reads the full announcement history from Envio HyperSync through a server route (`/api/announcements`; the token stays on the server, and only Kakushi's announcer is served). It then reads only the newest blocks over RPC. A HyperIndex v3 package (schema, handlers, derived Maker and route statistics) is in `packages/indexer/envio` and `fhe/indexer`, built and tested in CI.

**Evidence**
- Live: `https://kakushi.vercel.app/api/announcements?chainId=10143&from=70440000` returns the announcer's full history (source "envio-hypersync"). A full inbox scan of 350,352 Monad blocks takes 1.3 s.
- Honest note: the HyperIndex package is not deployed to Envio Cloud; the live use is HyperSync.

## 13. Optional promo clip (≤ 0:30)

`/Volumes/Extreme SSD/Projects/kakushi/docs/demo/kakushi-promo.mp4` (0:24). Full walkthrough (3:58, not a portal field): `docs/demo/kakushi-walkthrough.mp4`.

## 14. X link

**[user fills in]**
