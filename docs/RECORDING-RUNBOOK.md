# Recording runbook (≤ 3 minutes, live app)

The run is recorded on https://kakushi.vercel.app against Monad testnet and Sepolia. Every step below is a real transaction. The same flows passed by script on 13 Oct (`docs/evidence/testnet-*.json`), so the contracts and backends are known good.

## Before you press record

1. **Browser.** Chrome at 1440×900, one tab on https://kakushi.vercel.app, zoom 100%. A second tab on https://testnet.monadvision.com is useful for one cutaway.
2. **Wallet.** Click **Connect** in the app and log in with Privy (email). The embedded wallet's address is your recording wallet. Before recording, fund it from the hub (amounts at the bottom): MON and USDC on Monad, and a little ETH on Sepolia.
3. **Warm the backends** with one visit each, so no cold start appears on camera:
   - https://kakushi.vercel.app/bridge: wait for the Maker 1 quote;
   - https://kakushi.vercel.app/confidential: the FHE key loads, ~33 KB;
   - https://relayer-production-6ade.up.railway.app/health.
4. **Pre-register private receiving off camera** (optional; it saves 15 s): open Receive, click **Register**, sign, confirm.
5. **Check the header pill.** It should say **Monad testnet hub**. At wide widths it also shows "final in ~0.6 s"; hover it for the full Proposed → Finalized → Verified readout.

## The run

| # | Time | Click | What appears | Caption |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:15 | The landing page; scroll from the hero to "Two engines" | "The privacy provider for Monad", then ZK hides who / FHE hides how much | "On Monad every payment shows who and how much. Kakushi makes both private, for any app." |
| 2 | 0:15–0:25 | Hover the header pill | The live monadNewHeads readout: Proposed → Finalized ≈ 0.6 s, → Verified ≈ 1.5 s | "Monad finalizes in under a second; we read it live." |
| 3 | 0:25–0:50 | **Send**. Paste your own wallet in "Recipient meta-address or wallet", amount 0.01 MON, then **Send privately** and confirm | "Private address found", then done with the hash | "It lands at a one-time stealth address. The chain can't link it to me." |
| 4 | 0:50–1:05 | **Receive**, then **Scan** | The new payment in the inbox | "Only my viewing key finds it." |
| 5 | 1:05–1:50 | **Confidential**, Balance tab. Enter 1 USDC, **Make private**, confirm (approve + wrap), then **Reveal** | The balance shows dots, then the decrypted amount after the signature | "1 USDC is now a ciphertext. Only I can read it, sealed to this tab." |
| 6 | 1:50–2:20 | **Pay** tab, **Private recipient**. Paste your own wallet, amount 0.3, **Pay privately**, confirm | Done: the amount is encrypted and the recipient is a stealth address | "Hide who and how much, in one transaction." |
| 7 | 2:20–2:35 | **Receive**, **Scan**. The row reads "Encrypted · Reveal": click **Reveal**, then **Move to balance** | 0.3 USDC revealed, then "Moved to your private balance" | "The stealth key decrypts it and moves it on. The amount never goes public." |
| 8 | 2:35–2:50 | **Bridge**. Monad → Sepolia, 0.5 USDC, **Bridge**, confirm | The Maker 1 quote, then filled in ~25 s (cut the wait in the edit) | "Cross-chain too: Makers bonded on Monad, slashed by a ZK proof if they don't pay." |
| 9 | 2:50–3:00 | **Plugin** (developers page) | The live `<KakushiPay>` widget and the SDK snippet | "One component makes any Monad app private." |

**Optional cutaway (if time allows).** Open step 3's transaction on MonadVision: the recipient is a fresh address with no history.

## Monad moments to hold on

- **Step 2:** the header pill's Proposed → Finalized → Verified timings.
- **Step 3:** the send completes within about a second of confirming.
- **Step 7:** the reveal waits for `finalized`, so a decrypted amount can't be reorged away.

## If something hiccups

- **Quote missing on Bridge.** Wait 5 s. The amount must be 0.1–1 USDC; the page names the range if not.
- **FHE step slow.** Browser encryption takes a few seconds on first use. Cut it in the edit, or rerun step 5 (wrapping again is fine).
- **"Balance doesn't cover the gas to move it"** on Receive. The stealth address was forwarded less gas than needed. Use **Withdraw** instead; this is rare after the 13 Oct fix.
- **A Railway service is down.** Every page names the missing service ("… is not configured / unreachable"). Restart it in the Railway project `kakushi-monad`, or skip that step: steps 3–7 need only the FHE gateway, and step 8 needs Maker 1.
- **Fallback footage.** The scripts in `scripts/*-testnet.ts` reproduce each flow with printed timings and hashes, so a terminal cutaway can replace a failed step.

## What the run consumes

| Item | Monad | Sepolia |
| --- | --- | --- |
| Step 3: private send | 0.01 MON + ~0.02 MON gas | |
| Step 4 (or prep): register keys | ~0.015 MON | |
| Step 5: approve + wrap | ~0.1 MON gas, 1 USDC | |
| Step 6: encrypted stealth pay | ~0.08 MON gas + ~0.073 MON forwarded, 0.3 cUSDC | |
| Step 7: move | paid from the forwarded gas | |
| Step 8: bridge | ~0.01 MON gas, 0.5 USDC | |
| **Total** | **~0.32 MON + 1.5 USDC** | 0 (receive only) |

**Fund the recording wallet with 1.5 MON + 2 USDC on Monad**, which leaves room for one full retake. Add 0.002 ETH on Sepolia if you also show a shielded withdraw there. Nothing else needs funding: Maker 1, the relayer and the FHE KMS key are funded.
