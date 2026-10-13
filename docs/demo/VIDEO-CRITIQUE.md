# Video critique (judge's view, written by the team)

Reviewed from 30+ extracted frames of `kakushi-demo.mp4` and its captions, read as a Metropolis judge would. (The first cut of 13 Oct was never finished: its Receive step stalled during recording, see below, so this critiques the rebuilt cut.)

**What works**
- Everything is live footage of kakushi.vercel.app, tagged per chain, with real receipts on screen (1.10 s stealth send, 0.7–1.0 s Monad receipts on the bridge, 16.9 s on Sepolia, labelled at ×4).
- The whole product appears: stealth send, Privy, Shield with an in-browser proof (7.3 s) and a relayer-paid withdraw to a never-funded address, the first live private bridge delivery (0.44955 USDC to a one-time address in 11 s), FHE make-private / reveal / encrypted stealth pay / KMS cash-out, the CRE attestation window that covers that payout, and the widget.
- The limits are said aloud: one hosted engine holds the FHE key; the attester is Kakushi's runner using CRE logic, not a DON; slashing is fork-tested.

**What a judge will doubt or miss**
- **The recipient side is the weak spot.** The Receive inbox scan pages Monad's RPC 100 blocks at a time over ~290k blocks and did not finish (15 min, then "Couldn't reach Monad"). The cut shows the scan starting and says why, but a judge never sees "Encrypted · Reveal → Move to balance". An indexed scan (announcements from the indexer, or a scan from the user's registration block) is the fix, and should come before any re-record.
- **Privy is only the sign-in modal.** The recording connects a browser wallet because email needs an OTP. Privy gas sponsorship and the policy wallet aren't shown.
- **The shield anonymity set is tiny.** The Sepolia 0.001 ETH withdraw landed 3 blocks after its own deposit in a pool with few notes. The mechanism is real; the privacy of that one withdraw is weak.
- **Dense pacing.** About 30 s of the 2:53 is sped up ×2–×4 (chips shown). A first-time viewer may want one more second on each result card.
- **The pitch opening uses graphics** with placeholder ledger rows; the demo cut has none.

**If we re-record:** fix the inbox scan first, then add the Receive reveal + move (it exists and passed by script on 13 Oct), and show Privy email login with a real inbox.
