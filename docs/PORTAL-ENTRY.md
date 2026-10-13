# Kakushi: portal entry

This file follows the hackathon.monad.xyz "Complete your entry" page, top to bottom. Paste each block into its field. It supersedes PORTAL-FORM.md. Lines marked **[user]** are yours to fill in. The live URL everywhere is **https://kakushi.vercel.app**.

## Primary track
> Your project is judged in one track. Choose it before you add bounties.

Trust, Identity & AI Infrastructure

## Project details

### Logo
> PNG, JPG, or WEBP · Max 2 MB · At least 500 px · Up to 2000 × 2000 px

docs/brand/logo-portal.png (1000×1000, 42 KB)

### Name   (7 / 120)

Kakushi

### Tagline   (161 / 200)

The privacy provider for Monad: ZK hides who, FHE hides how much. Stealth payments, a shielded pool, encrypted amounts and a private bridge that any app can add.

### Description   (4213 / 8,000)

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

### First users + how we reach them   (1828 / 8,000)

FIRST USERS
1. Monad payment and payroll apps that pay people on chain: contractors, creators, payroll. They need salaries and payouts that aren't public, and they can't build ZK or FHE themselves. Kakushi gives them encrypted amounts (cUSDC/cAUSD) and stealth payouts behind one SDK call.
2. Wallets on Monad. They can add "receive privately" (a stealth meta-address registered with one signature) and an inbox that finds incoming private payments, by embedding the SDK.
3. Merchants and OTC desks that settle in USDC and don't want their volumes and counterparties readable on an explorer. They would use shielded pools and private calls into their existing contracts.
4. Cross-chain users moving USDC into Monad who don't want their Monad address tied to their source-chain history: private delivery over the Maker bridge.

HOW WE REACH THEM?
- Go to builders first. Kakushi is a plugin, so the first customers are Monad app teams, not end users: hackathon and ecosystem teams, Monad developer channels, and direct outreach to wallet and payroll teams with the three-line <KakushiPay> integration.
- Make adoption a copy-paste: the widget, the SDK, `KakushiConfig` for confidential contracts, and a permissionless pool factory, so a team can make its own token private without asking us.
- Show it working: a live app on testnet with public evidence (every claim backed by a transaction), which teams can try before they integrate.
- Grow the anonymity set, which is what makes privacy real. Each integrated app adds deposits to the shared pools, so every new app makes every other app's users more private.
- After the hackathon: audits of the circuits and contracts; splitting the FHE KMS across independent operators; a production Chainlink CRE workflow on a DON; and a cheaper withdraw verifier, so gasless works on Monad.

### Repository
> Public, or shared with metropolis@hackathon.monad.xyz.

https://github.com/nickthelegend/kakushi

## Demo and pitch

### Live URL
> Must run on Monad Mainnet or Testnet.

https://kakushi.vercel.app

### Demo video
> Show the working product, not slides or a code walkthrough. Up to 3 minutes.

Upload `docs/demo/kakushi-demo.mp4` (2:53, live footage on Monad testnet + Sepolia) to YouTube (unlisted), Loom or Vimeo, then paste ONE video link: **[user]**

[x] Let organizers show it publicly: **[user decides]**

### Pitch video
> Introduce your team, the problem you solve, and why you are building it. Up to 2 minutes.

Upload `docs/demo/kakushi-pitch.mp4` (1:20), then paste ONE video link: **[user]**

Team: **[user fills in]**

### Judge testing instructions   (2166 / 8,000)
> Private to your team, judges, and organizers.

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

## Bounties

### Best workflow with CRE   (Chainlink)

**Describe how CRE is used as an orchestration layer**   (1625 chars)

Kakushi's bridge promises that if a Maker doesn't pay, the user can prove it and is paid from the Maker's margin on Monad. Proving that a payout did NOT happen needs complete, gap-free commitments to other chains' history. Chainlink CRE is that orchestration layer.

One CRE workflow per chain (packages/cre/src/attest-workflow.ts, @chainlink/cre-sdk; workflows/attest-monad, attest-sepolia, plus the unfunded spokes) runs on a cron trigger:
1. Hub reads (EVMClient.callContract at finalized: EBC.allMakers, AttestationOracle.lastPayoutToBlock).
2. The next contiguous block range on the chain.
3. filterLogs for PayoutRouter.Payout, SourceRouter.PaymentEncoded and USDC Transfer(to = Maker).
4. Normalized into sorted Poseidon2 trees (the same attest-core code the Noir circuits' witnesses use).
5. writeReport to AttestationOracle.onReport on Monad.

The oracle accepts only block-contiguous payout windows from the forwarder with the pinned workflow owner. Kakushi's dispute circuit (Noir/UltraHonk) then proves a payment is in an attested source window and absent from the attested payout windows. DisputeModule verifies it and slashes the Maker.

Live: `cre workflow simulate` (CLI v1.36.0) run against live testnet state computes the next contiguous Sepolia window (docs/evidence/cre-simulate-attest-sepolia-testnet.txt). The hosted runner delivers the same logic's windows on chain through Chainlink's MockKeystoneForwarder. Honest scope: the mock checks no signatures, so on-chain windows are trusted from Kakushi's runner, not a DON. The full slash has run on a local fork only (no testnet transfer has gone unpaid).

**Video (required, ≤ 2:00): a CRE CLI simulation or live deployment**

Upload `docs/demo/bounty-cre.mp4` (1:24: a real `cre workflow simulate` run, plus the on-chain window tx), then paste the link: **[user]**

**What we did**
- Built one CRE workflow per chain with @chainlink/cre-sdk: cron trigger, EVMClient reads at finalized, filterLogs, writeReport.
- Committed each chain's Maker payouts and source payments as sorted Poseidon2 window roots in AttestationOracle on Monad, with contiguous payout windows.
- Made a missing payout provable: the Noir dispute circuit checks against those roots, and DisputeModule slashes the Maker.
- Ran `cre workflow simulate` against live testnet state, and delivered windows on chain through the hosted runner.

**Evidence**
- CLI simulation log: https://github.com/nickthelegend/kakushi/blob/main/docs/evidence/cre-simulate-attest-sepolia-testnet.txt
- On-chain window (10,000 Monad blocks in one report): https://testnet.monadvision.com/tx/0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8
- Window #44, from the runner key, covers the demo's private bridge payout: https://testnet.monadvision.com/tx/0xe00a40a0559c68f251fdf70ccd04bd0c07c10c25a3ca77b9c890d9f62e7562c7
- AttestationOracle: https://testnet.monadvision.com/address/0xc50A536E04DA4E2385e66fCf211820438F4905Da
- Article: https://github.com/nickthelegend/kakushi/blob/main/docs/CHAINLINK-CRE.md

### Privy!   (Privy)

**Describe how the project meaningfully integrates Privy (beyond login)**   (1350 chars)

Privy is Kakushi's login (email, Google or any wallet) and, beyond login, the custody layer for a bridge Maker's hot key. A Maker must sign by itself, within seconds; normally that is a raw key on a server that can move all inventory.

Kakushi's Maker can run on a Privy server wallet fenced by a default-deny policy, built from the deployment by packages/maker/scripts/privy-setup.ts. It allows only:
- PayoutRouter fill/refund on the deployed chains, with a native-value cap;
- DisputeModule.answerDispute;
- USDC approvals to the PayoutRouter or the MDC;
- MDC.depositMargin and EBC.setActive.

These are allowed only on chains 10143 and 11155111. `--update-policy` rewrites the policy in place; we did that live when Sepolia came online. packages/maker/src/signer.ts turns the server wallet into a viem Account, so the Maker engine signs through Privy's wallet RPC and never holds a key. A compromised Maker host can at worst pay out bridge transfers correctly.

Privy features used: embedded and external-wallet login, server wallets, and the policy engine (two rules per action: sign and send).

Live: Privy signed USDC.approve(PayoutRouter) and it landed on Monad testnet. It refused USDC.transfer to an outside address ("policy violation"). Honest scope: the live Maker 1 still runs a local key; the Privy wallet proves the policy separately.

**Video (optional, ≤ 2:00)**

Upload `docs/demo/bounty-privy.mp4` (1:02), then paste the link: **[user]**

**What we did**
- Privy login (email, Google, any wallet) on the app's Connect button.
- A Maker hot key as a Privy server wallet, with a default-deny policy built from the deployment and updated in place for new chains.
- A viem Account backed by Privy's wallet RPC, so the Maker never holds a key.
- Fixed a zero-fee signing bug found in the live proof (a legacy gasPrice now fills both EIP-1559 caps).

**Evidence**
- Allowed and landed: https://testnet.monadvision.com/tx/0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4 and, in the bounty video, https://testnet.monadvision.com/tx/0xd870e9ea01405d6d09e8a64db287a050639d6e42331ce0cb9b93e6bb48df1291
- Refused (policy violation), script output: https://github.com/nickthelegend/kakushi/blob/main/docs/evidence/testnet-privy.json
- Article: https://github.com/nickthelegend/kakushi/blob/main/docs/PRIVY.md

### Best Use of Envio   (Envio)

**Describe how HyperIndex/HyperSync/HyperRPC powers real data driving a feature**   (1210 chars)

Kakushi's stealth payments only work if the recipient can find them. The Receive inbox must read every ERC-5564 Announcement since the announcer was deployed and match each one against the user's viewing key, in the browser, so no server learns which payments are theirs.

Monad's public RPC caps eth_getLogs at 100 blocks. A day-and-a-half-old announcer was already about 290k blocks deep, so the inbox never finished (it gave up after 15 minutes during our demo recording).

Envio HyperSync now drives that feature. packages/app/src/app/api/announcements/route.ts queries https://10143.hypersync.xyz for the announcer's logs, following next_block to the archive height. The token stays on the server, and only Kakushi's own announcer is served. @kakushi/sdk scanAnnouncements takes this as its `history` source, decodes and matches every announcement locally, and reads only the newest blocks over RPC (12 in parallel), falling back to RPC entirely if HyperSync is down (tested).

Result: a full inbox scan over 350,352 Monad blocks in 1.3 s. A HyperIndex v3 package (schema, handlers, derived MakerStats/RouteStats) is in packages/indexer/envio and fhe/indexer, tested in CI but not deployed to Envio Cloud.

**Video (optional, ≤ 2:00): data flowing end to end**

Upload `docs/demo/bounty-envio.mp4` (0:57), then paste the link: **[user]**

**What we did**
- Moved the Receive inbox's announcement history to Envio HyperSync (a server route, token kept server-side).
- Matched every announcement locally in the browser, so neither Envio nor Kakushi learns which payments are the user's.
- Read only the newest blocks over Monad RPC, with a tested full fallback.
- Built a HyperIndex v3 package for bridge analytics (derived Maker and route stats), tested in CI.

**Evidence**
- Live data: https://kakushi.vercel.app/api/announcements?chainId=10143&from=70440000 ("source": "envio-hypersync")
- A full inbox scan: 350,352 Monad blocks in 1.3 s
- Article: https://github.com/nickthelegend/kakushi/blob/main/docs/ENVIO.md

Not claimed: Mera (its passkeys are only in the FHE mobile app, which isn't part of the hosted product), Cleanverse (its onboarding is blocked), and Agora (AUSD flows are fork-only). Best Community Team Project: **[user decides]**.

## Optional promotion

### Promo video (≤ 30 s)

Upload `docs/demo/kakushi-promo.mp4` (0:24), then paste the link: **[user]**

### X link

**[user fills in]**
