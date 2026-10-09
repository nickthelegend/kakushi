# Monad Metropolis submission (draft, not submitted)

| | |
|---|---|
| Project | **Fhish Pay**, on **Fhish**: confidential payments infrastructure for Monad |
| Track | **T2 Consumer Products & Payments** |
| Bounties | **Agora**: Best Cross-Border Payments App ($10k, T2) · **Privy** ($5k, all) · **Envio** ($1k + hosting, all) |
| Not targeted (built, kept in repo) | Chainlink CRE delivery workflow; MetaMask Agent Wallet plugin (T1-only bounty) |
| Team | solo, from a spare account |
| Repo | to be pushed public, MIT (DEPLOY-LATER.md §5) |
| Live app | held until testnet go (DEPLOY-LATER.md) |
| Deadline | Tue 2026-10-13 23:59 ET |

## Pitch (≤ 2 min)

Stablecoin payments on a public chain publish your salary, your rent and your savings to everyone,
forever. That is why payroll, remittances and business payments still don't run on-chain.

**Fhish Pay makes the amount private and keeps everything else on-chain.** You hold real Agora AUSD
(or Circle USDC). Wrap it once and your balance becomes a ciphertext. Payments, payroll and pay links
are computed on encrypted numbers by Fhish, a fully homomorphic encryption network built for Monad.
The chain sees *who* paid *whom* and *when*, never *how much*. You, and only you, can reveal your own
balance.

It is built on Monad's speed. A payment is proposed, voted and **final in under a second**, and the
app shows each step live from Monad's own commit-state stream. Reveals wait for finality, so a reorg
can never leak a number.

- **Send across borders by link.** The amount is escrowed encrypted. The recipient opens the link,
  creates an account with a passkey (Mera) and claims it, without needing gas.
- **Payroll.** An employer pays the whole team in one transaction. Each salary is a separate
  ciphertext that only the employer and that employee can read. A policy-limited server wallet
  (Privy) can run it on schedule.
- **Cash out** to real AUSD at any time; only the amount you take out is revealed.

## Main-track scoring map

| Criterion (20% each) | Evidence |
|---|---|
| Product quality | Mobile app (Mera passkeys), web pay + payroll console (Privy), activity explorer (Envio); every number encrypted on the user's device |
| Technical excellence | Native tfhe-rs engine and parallel coprocessor, k-of-n input attestation and KMS, sealed user decryption, finality-gated reveals; pay links bound to a one-time key (front-run-proof claims), payroll operators, ERC-2612/ERC-3009 gasless onboarding; Solidity, TypeScript and end-to-end tests on real AUSD |
| Monad integration | `monadNewHeads` commit-state ladder in the product; reveals gated on `finalized`; `eth_sendRawTransactionSync`; gas set on the limit; 100-block log paging; Agora AUSD + faucet and Circle USDC on Monad testnet |
| Track fit (T2) | Consumer payments: private sends, cross-border pay links, payroll, private balances |
| Innovation | First FHE payments stack on Monad; encrypted amounts with sub-second, visible finality |

## Agora: Best Cross-Border Payments App (T2)

"Build a mobile app letting users send AUSD across borders using Mera passkey onboarding and instant
settlement."

| Requirement | Where | Status |
|---|---|---|
| Mobile app | `mobile/` (Expo) | in progress |
| Mera passkey onboarding | `mobile/` | in progress |
| Send AUSD across borders | cAUSD over real AUSD; pay links (`createLink`/`claimLink`) for recipients without accounts | contracts + e2e done |
| Instant settlement | Monad commit-state ladder per payment (`sdk/src/monad.ts`, live tests against testnet) | SDK done |

## Privy ($5k)

"Integrate Privy beyond authentication." Gas-sponsored wraps, payments and claims on Monad testnet;
a Privy server wallet with a policy (only `runPayrollFrom` on cAUSD) as the payroll operator.
Status: in progress (`app/`, needs the owner's Privy app credentials to run on testnet).

## Envio ($1k + hosting)

HyperIndex over Fhish Pay, the decryption oracle and the FHE executor. Derived entities: payment
graph without amounts, pay-link lifecycle and claim times, payroll runs, reveal latency, public TVL,
FHE ops per opcode. Powers the app's Activity page. Status: in progress (`indexer/`).

## Demo video script (≤ 3 min)

| Time | Shot |
|---|---|
| 0:00 | Phone: create an account with a passkey (Mera). Get AUSD, make it private with one signature |
| 0:25 | Send 250 AUSD to a friend abroad by link; settlement ladder: proposed, voted, final < 1 s |
| 0:50 | Friend opens the link on another phone: passkey account, claims, taps Reveal: 250 (amber) |
| 1:15 | Web: employer signs in with Privy; payroll for 3 people; salaries encrypted in the browser; gas sponsored |
| 1:45 | Employee view: sees only their own salary; a colleague's is refused |
| 2:05 | Activity (Envio): payments, links, reveal latency, TVL; amounts shown as ciphertext |
| 2:30 | Cash out to real AUSD; only that amount is revealed |
| 2:45 | Terminal: e2e on real AUSD passes; Monad heartbeat |

## Limitations to state

- Local fork only until the owner funds the deployer and says go; no public tx hashes yet.
- Passkeys on device need the owner's domain (Associated Domains) and Apple team.
- Privy flows need the owner's Privy app (ID, secret, sponsorship enabled).
- One engine holds the FHE secret key; KMS keys run in one process locally (README, Trust model).
- tfhe-rs commercial use needs Zama's patent license.
