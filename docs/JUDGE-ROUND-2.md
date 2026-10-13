# Judge round 2

An independent judge (a fresh agent, given only the live app, the public repo, docs/PORTAL-COPY.md and the official rubric) reviewed Kakushi on 13 Oct 2026, 20:05 IST. Its verdict, verbatim:

---

# Kakushi: judge review (Monad Metropolis, T4)

## 1. Scores

**Main track (T4 Trust, Identity & AI Infrastructure)**

| Criterion | Score | Reason |
| --- | --- | --- |
| Product quality | 5 | The UI looks polished, but the live data contradicts itself across pages. The header Connect button is clipped at 1024 px, the landing shows made-up Maker numbers, and the SDK install line fails. |
| Technical excellence | 6 | There is real work here: an on-chain Noir/UltraHonk verifier, Poseidon2 attestation windows, a real CRE SDK workflow and 44 verified contracts. But DisputeModule has 0 transactions, and the attestations can be forged through the mock forwarder. |
| Monad integration | 6 | Monad is the hub and the finality indicator is live. But a ZK withdraw on Monad costs 6.2M gas (0.70 MON to withdraw 0.1 MON), so gasless is switched off on Monad by the team's own README. |
| Track fit | 5 | This is privacy and bridge infrastructure, a stretch for "trust" and not related to identity or AI. The trust piece (disputes and slashing) is the part that has never been run. |
| Innovation | 7 | Combining ZK for "who" with FHE for "how much", and proving a missing payout against sorted windows, is new. The parts are known patterns (Umbra, Tornado, a Zama clone, Orbiter). |
| **Weighted total** | **58 / 100** | |

**Bounties**

| Bounty | Requirement (40) | Technical (30) | Monad (20) | Innovation (10) | Total |
| --- | --- | --- | --- | --- | --- |
| Privy | 24 | 17 | 12 | 6 | **59** |
| Chainlink CRE | 27 | 17 | 15 | 7 | **66** |

- **Privy.** A server wallet with a policy does go beyond login. But the policy wallet `0x8d1D…4f63` has exactly one outgoing transaction (an approve, nonce 0) and holds no USDC. The Maker actually running fills is `0xa99c…Bb5B`, so the Privy wallet is a side demo, not the Maker's hot key as the copy says.
- **Chainlink CRE.**
  - The workflows are legitimate CRE SDK code (`Runner`, a cron trigger, EVM reads, log filters, `writeReport`), plus `workflow.yaml` and `project.yaml`.
  - The on-chain evidence, however, comes from `packages/cre/local/runner.ts`. That file does not use the CRE SDK or WASM. Its own header says it is not a Chainlink DON. It calls `MockKeystoneForwarder.report(…, "0x", [])` with no signatures, from the externally owned account `0x4d9e…DAb2`.
  - The "pinned workflow owner" is that same account, written into report metadata the caller makes up. The mock forwarder is used by other people too (last seen 53 s ago). So, by my reading, anyone could push attestation windows.

## 2. Claims I could not verify
- **"Receipt in 431 ms, Finalized in 1,020 ms."** MonadVision only shows a timestamp, and the repo has no timing log.
- **"`cre workflow simulate --broadcast` (CLI v1.36.0)."** I found no simulate output in the README, SUBMISSION.md or the evidence files. The only attestation transaction (`0x29f2…00b8`) comes from the local runner's account, with empty signatures.
- **"A Maker that doesn't pay is slashed with a ZK proof."** DisputeModule `0xE701…3aF9` shows 0 transactions on MonadVision, and the README lists no slash transaction. Meanwhile /disputes shows an Overdue case that nobody has slashed.
- **"Privy refused USDC.transfer."** The only proof is a self-written JSON file (`docs/evidence/testnet-privy.json`). By nature, nothing about a refusal is on-chain.
- **"Full confidential flow, 8/8."** ConfidentialStealthPay has 3 `Pay` transactions, all from the deployer `0x2c76…C24C`. Reveal and KMS cash-out exist only in `testnet-fhe.json`, and I cannot check a decryption from outside.
- **"Balances only the owner can decrypt."** The FHE README says "One engine holds the TFHE client key", so that operator can decrypt everything. The portal copy contradicts the team's own README.
- **"Deliveries can go to a stealth address."** The featured bridge payout `0x7bd8…70c1` paid 0.27972 USDC to `0x2c76…C24C`, the deployer's public wallet. I found no stealth delivery among the listed transactions.
- **"A hosted runner."** /attestations shows a lag of 4,408 s on Monad and 5,184 s on Sepolia, so it is not running continuously.
- **"44 contracts verified."** I spot-checked AttestationOracle and cUSDC, and both are full matches. I did not check all 44.
- **`pnpm add @kakushi/sdk`** (shown on /developers): the npm registry returns 404.

## 3. Broken or confusing steps
- **/send, /shield, /bridge, /maker at 1024 px:** the header Connect button overflows (page width 1064 vs a 1024 viewport). Clicking it scrolls the whole page sideways. /maker tells you to "Use the Connect button at the top right", and that button is half off-screen.
- **Landing at 1024 px:** the "Add privacy" button in the header is clipped.
- **/bridge:**
  - The banner says "Monad in ≈1 s" while the quote just below says 24.8 s. The landing stat also says "≈1 s private bridge".
  - The fee shows 0.020, but 1 USDC turns into 0.97, a 0.03 difference.
- **The same 0.509 USDC Monad→Sepolia transfer has three different statuses:**
  - "Completed, 23.0 s" on /explorer;
  - "Overdue" on /bridge and /disputes;
  - and /market says "0 open disputes".
- **/explorer:** a "Monad → refund, 5 USDC, In flight, 20h ago" row is stuck.
- **/bridge recent transfers:** rows read "Monad → ?", and "0.1725 ETH · No obligation" is never explained.
- **/shield → Withdraw:** a "Gasless via relayer" checkbox is shown on Monad, where the README says gasless is uneconomic. It still asks you to connect a wallet before a gasless withdraw.
- **/market:** shows "Reading the hub…" for about 5 s before anything loads.
- **Landing Maker card:** shows "Maker B, 2,000 USDC margin, p50 ≈450 ms, Sepolia → Base". The live data is Maker 1 with 1 USDC margin, a 1 USDC max transfer and p50 of 14,000 ms, and Base is "Awaiting funding". The card is fiction.
- **Console:** no errors. The wallet config lists chain 10143 twice.

## 4. Dense or ugly screens
- **Landing, 390 px:** the page is 11,800 px tall. The first screen has only the headline and coin art, with no sentence saying what the product does and no "Open app" button.
- **Landing compare table, 390 px:** the Kakushi column, the one that matters, is cut off, so you have to scroll inside the table to see it.
- **/attestations, 390 px:** the "Ends" column breaks mid-word ("1 / ag"), and the Blocks and Root columns are hidden.
- **/attestations, desktop:** 32 rows, most of them 0 leaves with the same root `0x1ed5c2e065…`. It reads as noise, and the order mixes 1h-old and 21h-old rows.
- **App header, 1024–1100 px:** eight navigation items plus the network pill plus Connect do not fit.
- **App pages (/send, /shield, /confidential, /bridge):** these are clean and consistent. This is the best part of the product.

## 5. First 60 seconds
- **What a judge understands:** privacy for Monad, with stealth addresses, a ZK pool, FHE amounts and a bridge. It looks professional, and the live finality pill ("final in 0.6 s") is a nice Monad touch.
- **What confuses them:**
  - The main button, "Add privacy", goes to an SDK page whose install command fails, not to the app.
  - There are ten surfaces (Send, Receive, Shield, Confidential, Bridge, Plugin, Disputes, Explorer, Market, Attestations) for what is four products bolted together. It is unclear which one is the T4 "trust" story.
  - The first numbers a judge checks contradict each other: ≈1 s vs 24.8 s, a 2,000 USDC margin vs 1 USDC, Completed vs Overdue.

## 6. The reason I'd vote no
The privacy claims fall apart on the block explorer.
- **Withdraw linked to deposit.** The "best transaction" ZK withdraw `0x5ad4…33ca` was sent by `0x2c76…C24C`. That is the same wallet that made the deposit 33 s earlier (nonces 45 then 46), and it is also the deployer. Nothing is unlinked, and the withdraw cost 0.70 MON to move 0.1 MON.
- **Bridge payout to a public wallet.** The featured bridge payout went to that same public wallet.
- **Slashing never run.** The slashing module that carries the trust story has never been called, even though there is an Overdue case waiting on /disputes.
- **FHE key held by one operator.** A single operator holds the FHE key.
- **Privy wallet not the live Maker.** It has signed one approve.

This is a lot of breadth with impressive scaffolding, but the central promises are shown in docs, not on chain.

## 7. Top 10 fixes, by impact on the score
1. **Redo the flagship withdraw.** Deposit from wallet A, let other deposits land, then withdraw through the relayer to a fresh wallet B. Replace transaction #1 in the portal.
2. **Execute one real slash on Monad.** Use the Overdue 0.509 USDC case that is already on /disputes, then link the DisputeModule transaction.
3. **Run the live Maker on the Privy policy wallet.** Fills should be signed by `0x8d1D…`; link one fill transaction.
4. **Show a real CRE simulate run.** Commit the `cre workflow simulate --broadcast` log and its transaction hash. Keep the attester lag under 5 minutes, and state in the portal that the mock forwarder does not check signatures.
5. **Make the status data agree** across /explorer, /bridge, /disputes and /market. Replace every "≈1 s" bridge claim with the measured 11–27 s.
6. **Fix the landing Maker card.** Feed it live data or label it "example". Remove Sepolia → Base until Base is funded.
7. **Correct the portal copy.**
   - Replace "only the owner can decrypt" with a disclosure that one engine holds the key.
   - Replace "Monad absorbs the verifier" with the 6.2M-gas figure.
   - Hide the gasless checkbox on Monad.
8. **Fix the SDK install line.** Publish `@kakushi/sdk` to npm, or change the line on /developers to a git or workspace install.
9. **Fix the header overflow between 1024 and 1100 px** by collapsing the navigation earlier.
10. **Fix the mobile and bridge gaps.**
    - Add a one-line explainer and an "Open app" button to the mobile hero.
    - Stack the compare table and the attestations rows on narrow screens.
    - Add one bridge delivery to a stealth address as evidence.
