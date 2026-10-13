# Portal copy (hackathon.monad.xyz)

Each field below is ready to paste.

## Project name

Kakushi

## Tagline (≤ 80 chars)

The privacy provider for Monad: ZK hides who, FHE hides how much.

## Short description (≤ 280 chars)

Kakushi adds privacy to any Monad app: stealth addresses, a ZK shielded pool with gasless withdrawals and private contract calls, FHE-encrypted balances and payments, and a Maker bridge with ZK slashing. It ships as an SDK, a drop-in React widget and a live app.

## Full description

**Problem.** Every Monad transfer is public: who paid whom, and how much. Payroll, merchant payouts, OTC deals and any app paying users leak their whole history. Privacy tools exist, but each app would have to build its own cryptography.

**Solution.** Kakushi is a privacy plugin with two engines:
- **ZK hides who.**
  - Stealth addresses (ERC-5564/6538): pay a wallet, and the money lands at a one-time address only the recipient can find.
  - A shielded pool for any token (a permissionless factory): deposit, then withdraw to a fresh address with a Noir/UltraHonk proof, gasless through a relayer, or spend straight into any contract call bound by the proof.
- **FHE hides how much.** A native tfhe-rs engine with k-of-n input attestation and KMS. Balances and payments are ciphertexts that only the owner can decrypt, sealed to their own browser tab. Any contract becomes confidential with `contract MyApp is KakushiConfig` and the Zama-compatible `FHE.*` API.
- **Both at once.** An encrypted amount sent to a one-time stealth address, in one transaction.
- **Cross-chain.** A Maker bridge between Monad and Sepolia. Each Maker is bonded with margin on Monad, and a Maker that doesn't pay is slashed with a ZK proof checked against Chainlink CRE attestation windows. Deliveries can go to a stealth address.

Developers get `@kakushi/sdk`, `@kakushi/fhe-sdk` and the `<KakushiPay>` widget.

**Why Monad.** Private payments need fast, final settlement. On Monad a stealth payment's receipt arrives in 431 ms (`eth_sendRawTransactionSync`) and is Finalized in about 1 s (`monadNewHeads`). FHE decryptions are gated on `finalized`, so a reveal can never be reorged away. Monad's throughput absorbs the heavy UltraHonk verifier and FHE calls, and the app shows live finality in its header.

**What's live** (Monad testnet + Sepolia, all hosted, all exercised with real transactions):
- stealth send + scan;
- shield + ZK withdraw;
- gasless withdraw via the relayer;
- bridge in both directions (11–27 s);
- the full confidential flow, 8/8: wrap, encrypted stealth pay, reveal, move, encrypted pay, KMS cash-out, pay link;
- the Privy policy-fenced Maker wallet;
- Chainlink CRE attestation windows.

44 contracts are verified on Sourcify.

## Track

T4: Trust, Identity & AI Infrastructure

## Bounties claimed

### Privy ($5,000, all tracks): "integrate Privy beyond authentication"

- **Login.** Privy (email, Google, any wallet) is the app's wallet.
- **Beyond login: a server wallet + policy engine.** The bridge Maker's hot key is a Privy server wallet fenced by a default-deny policy. It may only fill or refund on Kakushi's PayoutRouter, answer disputes, and approve the PayoutRouter or MDC, on chains 10143 and 11155111 only (`packages/maker/scripts/privy-setup.ts`, updated in place with `--update-policy`). A compromised Maker host cannot move inventory or margin anywhere else.
- **Evidence (Monad testnet).**
  - Privy signed `USDC.approve(PayoutRouter)`, which landed: `0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4`.
  - Privy refused `USDC.transfer` to an outside address ("policy violation").
  - Script: `scripts/privy-proof-testnet.ts`.

### Chainlink CRE ($3,000, all tracks): "a CRE workflow used as an orchestration layer"

- **The workflows.** `packages/cre/workflows` (`attest-monad`, `attest-sepolia`, `source-native`, …) attest every chain's payout and source logs as sorted Poseidon2 window roots in the hub's `AttestationOracle`, with contiguous payout windows. Dispute proofs (Noir) are checked against these roots, which is what lets a missing payout be proven and the Maker slashed. CRE is the bridge's source of truth for remote chains.
- **Run as.** `cre workflow simulate --broadcast` (CRE CLI v1.36.0), plus a hosted runner that executes the same logic through Chainlink's `MockKeystoneForwarder` `0xB9F79d863261869B234c481D1f9A7af84AeAd192`. The oracle checks the forwarder and the pinned workflow owner.
- **Evidence.** A 10,000-block window attested on Monad testnet: `0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8`.
- **Stated plainly:** this is not a deployed DON workflow.

## Links

- **Repository:** https://github.com/nickthelegend/kakushi
- **Live app:** https://kakushi.vercel.app
- **Submission evidence:** https://github.com/nickthelegend/kakushi/blob/main/SUBMISSION.md

## Contracts (Monad testnet, MonadVision)

| Contract | Address |
| --- | --- |
| StealthRegistry | [0x8777bf242EEe2112BA9185FB6571604dFD543A62](https://testnet.monadvision.com/address/0x8777bf242EEe2112BA9185FB6571604dFD543A62) |
| StealthPay | [0x0f650e5bC29242eBc107CA7B879d33c4EE4f4B04](https://testnet.monadvision.com/address/0x0f650e5bC29242eBc107CA7B879d33c4EE4f4B04) |
| KakushiPoolFactory | [0x2DfB49d4BDE2adF332407fe47dF835477a1Ecb3f](https://testnet.monadvision.com/address/0x2DfB49d4BDE2adF332407fe47dF835477a1Ecb3f) |
| cUSDC (FHE) | [0x18567b9fa61E7322f8d4111c7606107C7eEb55a1](https://testnet.monadvision.com/address/0x18567b9fa61E7322f8d4111c7606107C7eEb55a1) |
| ConfidentialStealthPay | [0x0b1fffD49Ccd2BcBDe14359C9435185A1607F7C6](https://testnet.monadvision.com/address/0x0b1fffD49Ccd2BcBDe14359C9435185A1607F7C6) |
| DisputeModule | [0xE701a71Ec80Db1e50fbA55fC902CBc8919dD3aF9](https://testnet.monadvision.com/address/0xE701a71Ec80Db1e50fbA55fC902CBc8919dD3aF9) |
| AttestationOracle | [0xc50A536E04DA4E2385e66fCf211820438F4905Da](https://testnet.monadvision.com/address/0xc50A536E04DA4E2385e66fCf211820438F4905Da) |

The full list is in the README.

## Three best transactions

1. **Shielded ZK withdraw to a fresh address** (UltraHonk verified on Monad): [0x5ad430ff…33ca](https://testnet.monadvision.com/tx/0x5ad430ff2f7eea02551543cca518374ba13212d4297c7f4689e611d3c8b633ca)
2. **Stealth payment**, receipt 431 ms, Finalized 1,020 ms: [0x7181caa5…8505](https://testnet.monadvision.com/tx/0x7181caa525a2f22f73cba6d07f5a402a6ecd20794077cb98d7584de9033b8505)
3. **Bridge payout on Monad**, 11.3 s after the Sepolia payment: [0x7bd85700…70c1](https://testnet.monadvision.com/tx/0x7bd857000ba31adc5b0f68ac9d95e14381d722bdbe3fc5a699bd68765c0670c1)

## Team and attribution

- **Team:** nickthelegend (solo builder).
- **Pre-existing code, disclosed:**
  - the UI kit `packages/ui` is a vendored copy of the Polaris design system, re-themed;
  - the FHE half (`fhe/`) was imported from the builder's own Fhish project during the hackathon, with its git history.
- **AI tools disclosure:** built with Claude Code (Anthropic) as a coding agent across code, tests, deployment and docs. Landing art is AI-generated (ChatGPT images, Gemini), re-graded to the palette. Every on-chain claim is backed by a real transaction listed in SUBMISSION.md.
