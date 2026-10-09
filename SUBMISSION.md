# Submission evidence checklist

Draft only; not submitted or published. Local implementation and baseline gates have been exercised by the build team. The four-scenario real local fork demonstration passed on 2026-10-08; this is local evidence, not public deployment evidence.

| Scenario | Required evidence | Current result |
| --- | --- | --- |
| A: USDC Sepolia to Monad | Source receipt, Maker payout, balances and elapsed time | PASS: 4.962545 USDC received on Monad |
| B: dead Maker slashed with ZK proof | Real proof timing, dispute/slash receipts, sender restitution and Maker margin delta | PASS: 7.009001 USDC compensated; final replay proof 725 ms; Maker B continued filling |
| C: invalid code refund | Refund receipt, amount and actual fees/code dust | PASS: 3.009999 sent, 2.97 refunded, 0.039999 fee/code dust |
| D: native ETH Sepolia to Base | Source receipt and destination native balance delta | PASS: 0.010000000000009003 ETH sent; 0.00987525 ETH received |

Add repository URL, permitted app URL, demonstration video, local contract addresses with explicit fork labels, test/build logs and reproducible commands. Public explorer links must correspond to actual public transactions, never local fork hashes. Include limitations from [SPONSOR-GAP](docs/SPONSOR-GAP.md): local CRE runner is not DON execution, Privy is untested, Cleanverse ABI/onboarding is blocked, and local indexing is not Envio Cloud.

The final pitch should demonstrate the actual fill/refund/dispute behavior and proof enforcement without presenting a fixture, local deployment, or credential placeholder as a live sponsor integration. Hosting, public-chain activity and submission remain under the [deployment hold](docs/DEPLOY-LATER.md).

Separate UI evidence: custom-recipient and reverse-direction transfers settled; in-browser UltraHonk proof and dispute submission succeeded (8,508 ms). Maker margin deposit and timelocked withdrawal request succeeded. The final SQLite indexer snapshot contains nine source payments: six observed fills, one refund and two slashes. Envio codegen and seven offline lifecycle/statistics/client tests pass; its managed runtime remains unverified. [Verification record](docs/VERIFICATION.md). These results do not satisfy the remaining sponsor or hosted submission requirements.
