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


---

## Re-judge after the fixes (a fresh judge, same prompt, 13 Oct 2026 ~21:00 IST)

Scores moved from 58 to 64 for the track, from 59 to 65 for Privy, and from 66 to 74 for Chainlink CRE. The verdict, verbatim:

# Kakushi: judge review (Monad Metropolis, T4)

Checked on 13 Oct 2026, using the live app (desktop, 1440x900 and 390x844), the public GitHub repo, MonadVision, Sepolia Etherscan and PORTAL-COPY.md. I did not log in or sign anything.

## 1. Scores

| Main-track criterion (20% each) | Score | Reason |
|---|---|---|
| Product quality | 6 | The UI is polished and the stealth-recipient lookup works live. But the bridge quotes nothing ("price feed stale"), pages disagree about the same transfer's status, and the finality pill can't be seen below 1536 px. |
| Technical excellence | 7 | The Noir/UltraHonk verifier works on chain, there is a real CRE SDK workflow, and the contracts I sampled are verified (Full Match). Against that, the FHE key sits in one hosted engine, attestations go through a mock forwarder, and a withdraw costs 6.2M gas. |
| Monad integration | 6 | It is deployed on Monad and uses `eth_sendRawTransactionSync` and `monadNewHeads`. But the Monad shielded pool is uneconomic: a 0.1 MON withdraw paid a 0.698 MON fee. Gasless withdrawal only makes sense on Sepolia. |
| Track fit (T4) | 6 | It fits "Trust" as privacy infrastructure, but it has no identity or AI angle beyond the stealth registry. |
| Innovation | 7 | Combining ZK and FHE in one transaction, and slashing a bridge Maker with a ZK proof checked against CRE windows, are good ideas. Each part exists elsewhere already (Umbra, Tornado, Zama, Orbiter). |
| **Weighted total** | **64 / 100** | |

| Bounty | Meets requirement /40 | Technical /30 | Monad /20 | Innovation /10 | Total |
|---|---|---|---|---|---|
| Privy | 27 | 19 | 12 | 7 | **65** |
| Chainlink CRE | 32 | 21 | 13 | 8 | **74** |

- **Privy:** It goes beyond login: `privy-setup.ts` creates a server wallet with a default-deny policy through `@privy-io/node`. But the live Maker 1 (`0xa99c…Bb5B`) does not use it. The only on-chain evidence is one infinite `USDC.approve` from a separate wallet (`0x8d1D…4f63`). The refusal exists only as JSON.
- **CRE:** `attest-workflow.ts` uses the `@chainlink/cre-sdk` CronCapability, EVM reads and `writeReport`, and a `cre workflow simulate` log exists. But the simulated window had 0 leaves and txHash `0x000…`. Every live window is written by Kakushi's own runner (`0x4d9e…DAb2`) through MockKeystoneForwarder, not by CRE.

## 2. Claims I could not verify

- **"Receipt in 431 ms, Finalized at 1,020 ms."** The tx `0x7181…8505` exists: SendNative, 0.01 MON, with a fee of 0.0124 MON, so the fee is larger than the payment. The timings come only from the team's own JSON. I could not see them in the app, because the finality pill is `hidden 2xl:inline-flex`.
- **"Full confidential flow, 8/8."** `testnet-fhe.json` has no transaction hashes. All I could confirm is that ConfidentialStealthPay and cUSDC (named "KakushiPayToken" on MonadVision) were last active about 1h40m before my check.
- **ZK slashing "7.009 USDC, 725 ms".** This ran on a local fork only. DisputeModule `0xE701…` was last seen at deployment, so no dispute has ever been filed on testnet.
- **"44 contracts verified."** I spot-checked 3 (DisputeModule, ConfidentialStealthPay, cUSDC), and all were Full Match. I did not check the other 41.
- **Privy refusal ("policy violation").** This exists only in `testnet-privy.json`, which is unverifiable by nature.
- **"Private calls into any contract" and the "permissionless any-token factory".** No transaction is given, and I found no pool opened by a third party.
- **Withdraw cost.** The portal says about 0.7 MON. The README and SUBMISSION.md say about 0.9 MON. On chain it was 0.698 MON. The docs contradict each other.
- **Gasless withdraw.** It is real on Sepolia (`0x0288…`): `0x839c…` was never funded and got 0.0009 ETH, and the relayer took 10%. But that pool has exactly 1 deposit (block 11906271, from the deployer `0x2c76…`) and 1 withdraw (block 11906272). The anonymity set is 1 and the link is trivial. The Monad pool is the same: 2 transactions, both from `0x2c76…`.

## 3. Broken or confusing steps

- **/bridge:** The first load quoted 0.97 USDC from Maker 1. Every later load (desktop and mobile) said "No Maker can take this transfer right now (price feed stale)". The headline flow is down.
- **One transfer, three statuses:** The 0.509 USDC Monad→Sepolia transfer shows "Completed, 23.0 s" on /explorer, but "Paid late" on /bridge and /disputes.
- **Maker margin disagrees across pages:** The landing page says "1.5 USDC, required 1.1". /market says "Margin 1, needs 1, 100%".
- **/explorer contradicts the portal:** It shows a 5 USDC "Monad → refund" as "Not paid in time" (20h ago). The portal says no Maker has failed to pay. /market caps transfers at 1 USDC, and /disputes has no case for this transfer.
- **/confidential overclaims:** "How it works" says "Only you can reveal your balance". That is false while one hosted engine holds the FHE key.
- **/attestations overclaims:** It says "Chainlink CRE commits every Maker payout". The team's own copy says the attestations come from Kakushi's runner, not a DON.
- **The bridge is not private:** The bridge payout `0x7bd8…` paid the sender's own public wallet `0x2c76…`. /explorer publicly lists the sender's address, which is odd for a privacy product.
- **/send:** Entering an unregistered 0x address shows "hasn't turned on private receiving", with no next step.
- **"Monad → refund":** Visitors see this route label, and it is jargon.

## 4. Dense or ugly screens

- **/attestations, desktop:** An AI-art banner pushes the data below the fold. "5630 s lag" is shown twice, and in raw seconds.
- **/market, desktop:** "Margin 1 / needs 1" has no units, and "p50 payout 14000 ms" should be written in seconds.
- **Landing, 390 px:** The subtitle and CTAs stay invisible for about 3 s (badge blurred), and there are long empty gaps between sections.
- **/explorer, 390 px:** The route column is just two coin icons, with no time or sender shown, followed by a large empty area below.
- **Connect menu, desktop:** The Privy option's description is cut off ("Disputes on M…").

## 5. First 60 seconds

- **What lands:** "Make anything private", "ZK hides who, FHE hides how much", clean app tabs (Send, Receive, Shield, Confidential, Bridge), and a live Maker card read from Monad.
- **What confuses:**
  - Four products plus a bridge, a market, disputes and attestations is a lot to take in at once.
  - Nothing can be done without a wallet, and there is no demo video or read-only walkthrough.
  - The only live-looking flow (the bridge) says no Maker is available.
  - The "live finality" header is invisible on a normal laptop.

## 6. The reason I'd vote no

It is a privacy product where every live privacy demo has an anonymity set of one, all from the deployer's wallet. The bridge pays the sender's public address. The FHE key and the "CRE" attestations are both held by the team. The shielded pool costs 7x the note on Monad. It is impressive breadth, but no privacy is actually demonstrated on Monad, and the UI claims more than the team's own caveats allow.

## 7. Top 10 fixes, ordered by impact on the score

1. Fix the bridge's stale price feed, and add a health check so a judge never sees "No Maker can take this transfer".
2. Produce real unlinkability on Monad: several deposits from distinct wallets into one pool, then a relayed withdraw to a fresh address. Link it as the main transaction.
3. Run one bridge delivery to a stealth address live, so the "private bridge" claim has a transaction behind it.
4. Change the UI wording to match the trust model:
   - /confidential: "Only you can reveal your balance" is not true.
   - /attestations: say "Kakushi runner using CRE logic", not that Chainlink CRE commits the payouts.
   - Landing: the "0 custodians" claim ignores the hosted FHE key.
5. Use one status source for the explorer, bridge and disputes pages. Reconcile the margin figures, and explain the 5 USDC "Not paid in time" (or file and slash it on testnet, which would be the best evidence there could be).
6. Show the finality pill at all widths. It is the main Monad selling point and sits behind `2xl` now.
7. Route the live Maker 1 through the Privy policy wallet. For extra Privy credit, add a second feature such as embedded-wallet signing for stealth keys.
8. Lower the Monad withdraw cost or batch withdraws. Otherwise, stop presenting the Monad shield as usable.
9. Add a no-wallet demo mode or a 90-second video on the landing page, and fix the 3-second hero fade on mobile.
10. Put full tx hashes in every evidence JSON (FHE 8/8, smoke), and make the 0.7 vs 0.9 MON figure consistent across the portal copy, README and SUBMISSION.md.
