# Kakushi demo videos (Monad Metropolis)

| File | Length | What it is |
| --- | --- | --- |
| [kakushi-demo.mp4](kakushi-demo.mp4) + [.srt](kakushi-demo.srt) | 2:53 | **The submission cut.** Live product only (no slides): the problem and the intended user, then a stealth send, Privy sign-in, Shield on Sepolia with a gasless relayed withdraw, a Monad → Sepolia bridge delivered privately, FHE (make private, reveal, encrypted stealth pay, KMS cash-out), CRE attestations, the Receive inbox, and the `<KakushiPay>` widget. |
| [kakushi-pitch.mp4](kakushi-pitch.mp4) + [.srt](kakushi-pitch.srt) | 1:20 | **The pitch.** Kinetic type in Kakushi's brand: hook, who we are (no names), the problem, why now, the product in three verbs, one card of testnet facts, who it's for and how they adopt it, the close. One 3.6 s live glimpse (encrypted stealth pay, tagged LIVE). |
| [kakushi-walkthrough.mp4](kakushi-walkthrough.mp4) + [.srt](kakushi-walkthrough.srt) | 3:58 | **The full walkthrough.** Every screen of the same live takes, including the operator side: Shield's any-token pools and private contract calls, the bridge, Claim/disputes and the watchtower, the Makers market and Maker console, the Explorer, Attestations, FHE, Receive, the Plugin page and SDK, and the honest limits. Slow parts at ×1.5–×4 with chips. |
| [kakushi-promo.mp4](kakushi-promo.mp4) + [.srt](kakushi-promo.srt) | 0:24 | **The promo.** A 24-second cut of the same live footage: stealth send, gasless ZK withdraw, private bridge payout, encrypted balance and payment, the widget. |

All are 1920×1080, H.264 + AAC at −16 LUFS, with burned-in captions (opaque) and a matching `.srt`. The narration is ElevenLabs **Lily** (Kakushi's voice in `metropolis-funding/VOICES.md`, `eleven_multilingual_v2`), with captions timed from its word timestamps.

## What is live footage

Everything in the demo cut is a screen capture of **https://kakushi.vercel.app** on Monad testnet (10143) and Sepolia, recorded on 14 Oct 2026 (IST), driven by Playwright with a drawn cursor. Each clip carries a tag: "LIVE · MONAD TESTNET", "LIVE · SEPOLIA TESTNET" or "LIVE · MONAD TESTNET → SEPOLIA".

- **Speed-ups are labelled.** Waits (typing, a Sepolia block, browser proving, the Maker's payout, page loads) play at ×2 or ×4 with a "▶▶ ×N" chip. Results, amounts and timings play at ×1. Timing badges quote the measured value (for example "Sepolia receipt 16.9 s, shown at ×4").
- **One still hold.** The Attestations page holds its last frame for 4 s (the page was not changing).
- **Not live:** the pitch is kinetic typography (HyperFrames) except one 3.6 s live glimpse. Its ledger rows and the "4,200 USDC" salary use placeholder addresses. The facts it shows are verifiable on testnet: 44 verified contracts, the 431 ms stealth receipt and ~1.0 s finality of `0x7181…8505` in [SUBMISSION](../../SUBMISSION.md), the FHE flow, the bridge, and the 6-deposit pool seeded by the team ([seed-13oct.md](../evidence/seed-13oct.md)).
- **The Receive inbox scan does not finish on camera.** The scan pages Monad's RPC 100 blocks at a time over about 290k blocks since deployment. On this take it ran for 15 minutes and ended with "Couldn't reach Monad". The cut shows the scan starting and says so plainly; the recipient-side proof shown instead is the bridge payout to a one-time address. An indexer-backed scan is the fix.
- **Privy.** The cut opens the real Privy sign-in modal, then connects a browser wallet, because email login needs a one-time code. That wallet is an injected EIP-1193 provider whose key stays in the Node recorder (the page only sees an address). No production code was changed for the recording.

## The recording wallet

`0x204c324730AF7b9F25686aC30489A886A4967033`: a fresh key (stored in `.stack/recording-wallet.json`, gitignored, mode 600), funded from the deployer.

| Funding | Tx |
| --- | --- |
| 1.5 MON (Monad) | `0x1858508ac823340ca4ba255f35aa77d5ebd7dcd2d87ecf68824d4e143830979a` |
| 2 USDC (Monad) | `0x35b074eb6560985a551c6b8fd341140efd3c23fd0b1b9372eb78841b2a16b37c` |
| top-up 1.0 MON (Monad) | `0x98668bb2ff24d5626faf4542806dd87f41ece64a82eeb18e6f5174353fc92cc2` |
| top-up 1 USDC (Monad) | `0x2824fc1d18a9cd11d503d4a04bcd7de8fef56862f65860281620aba9e6a07247` |
| 0.003 ETH (Sepolia) | `0x9a4a6d2c1b5648be9d08556c230a7c8a826fc09ee656cc3c1c4eedf8cb621985` |

**Spent:** about 0.34 MON (including the 0.01 MON sent to its own stealth address and 0.073 MON forwarded as gas to the encrypted payment's stealth address), 0.509 USDC bridged, 1 USDC wrapped (0.2 cashed back out), and about 0.001 ETH on Sepolia (the 0.001 ETH note plus gas).

## Transactions in the videos

Receipt latency is wall-clock time from submit to the first receipt, polled every 50 ms by the recorder.

| Step | Chain | Tx | Receipt |
| --- | --- | --- | --- |
| Register private receiving (off camera) | Monad | `0x398d67c27b1164a966c1f72dc2a1ecdb2b37492664422b05c8a95cf437034821` | 1.00 s |
| Stealth send 0.01 MON | Monad | `0x8bf529fb39c8bea0286da6ad01311443354d1008cd5da2c7cc3fe9d18333f051` | 1.10 s |
| Shield deposit 0.001 ETH | Sepolia | `0x343dce761b3ae0d3e6d43294fbab5add1e5998e44b8d4ed767dd25a717330040` | 16.9 s |
| Gasless withdraw to fresh `0xD1e0…e535` (sent by the relayer `0x62bd…6613`; proof made in the browser in 7.3 s; fee 0.0001 ETH) | Sepolia | `0x77721e1e13e72cca29692f23ddc815bb61149aa4eeafc6a77487e22b5da4a8f8` | |
| Bridge: approve USDC | Monad | `0x65183f4841765b78b78afc4ed826816556ad00e3dadf6a373cd75a84767f6f81` | 1.05 s |
| Bridge: 0.509 USDC source payment to Maker 1 | Monad | `0x44548194de39ba8b4de859e535a03554a593625f553197b7ee9075656cb1f3a1` | 0.73 s |
| Bridge: stealth announcement | Monad | `0x0a538a5c50da5304f011608fcbd1f165e0ce934e77d541a55fdd73ad7a6c59e2` | 0.73 s |
| Bridge payout 0.44955 USDC to one-time address `0xc196…6502`, 11 s after the source (block times); "Settled". The first live private (stealth) bridge delivery. | Sepolia | `0x77ebad1437d992a60d354ac04d10cc993906f7b9cb5b2a45ec73fca311b4be06` | |
| FHE: approve USDC | Monad | `0x7c3f97d24ea9536b608b92775699290556902bd27ad0a22c4252a15c88338570` | 1.23 s |
| FHE: wrap 1 USDC → cUSDC | Monad | `0x268bac1a2c5d35cdd86dfe76a29a7613b93b9f686747ccf0a7cd7f0d860872e4` | 0.99 s |
| FHE: encrypted stealth pay 0.3 cUSDC (two txs: approve + pay, 0.073 MON forwarded for the recipient's gas) | Monad | `0xe5b27ea328570729452f0d1f677a8f5734fe2a578e1f2d19e1acec9fe23034b9`, `0x0f1648c79bd81911ee25b75d1b55ef094aed50b252712b89af150a45fcf59d22` | 0.92 s, 0.98 s |
| FHE: KMS cash-out 0.2 USDC | Monad | `0x2e480103f7f75502863369cf4c17b04c238f747356c7130eba1b0ff9319b2e12` | 1.54 s |

The CRE attestation window #44 on the Attestations page (Sepolia payouts, blocks 11908661–11908835) covers the bridge payout above (block 11908833). It was written by Kakushi's runner using the CRE workflow logic, not by a DON.

Caveat on the shield leg: the 0.001 ETH Sepolia pool has few deposits, and this withdraw landed 3 blocks after its deposit, so the anonymity set is tiny. The leg shows the mechanism (in-browser proof, relayer pays the gas, a never-funded address receives), not a large set.

## Decisions

- **Voice:** Lily (assigned in VOICES.md). An earlier audition of Lily against Daniel was moot once the registry assigned Lily.
- **Capture:** headless Chrome at a 1536×864 CSS viewport and device scale 1.25, so frames are exactly 1920×1080 and the header's finality readout ("final in 0.6 s", shown from 1536 px) is visible. Frames come from CDP screencast and are written at a constant 30 fps of wall-clock time, so the on-screen timings are real.
- **Tags and captions** sit in the empty columns beside the app's centre column (or in the bottom band on full-width pages) and never cover the logo, nav, amounts, buttons or results.
- **No GitHub URL** appears in either video. The Plugin page's Install card, which shows the repo URL, is scrolled out of view before the capture starts.
- **Music:** a quiet synthesized pad (no third-party music).

## Rebuild

`docs/demo/_build/` holds the pipeline, adapted from `clockin/videos/_pipeline` for landscape web capture: `fund-wallet.mjs` / `topup.mjs` (funding), `rec-lib.mjs` (wallet bridge, cursor, capture), `record.mjs` / `record3.mjs` / `record4.mjs` / `record5.mjs` (takes), `tts.py` (ElevenLabs), `cards.py`, `spec_*.py` → `cut.py` (cut, speed chips, captions, mix). Intermediates go to `_build/work/` (gitignored).
