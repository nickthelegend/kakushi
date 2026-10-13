# Kakushi

**The privacy provider for Monad.** Kakushi adds privacy to any Monad app, including apps that were never built for it, using two engines:

- **ZK hides *who*.** Stealth addresses (ERC-5564 / ERC-6538), a shielded pool with Noir/UltraHonk proofs, private contract calls, gasless withdrawals through a relayer, and private delivery over a cross-chain bridge.
- **FHE hides *how much*.** Encrypted balances and payments on a native tfhe-rs engine, with k-of-n input attestation and KMS. Any contract becomes confidential with `contract MyApp is KakushiConfig` and the Zama-compatible `FHE.*` API.
- **Both at once:** an encrypted amount sent to a one-time stealth address.

Send, Receive, Shield, Confidential and Bridge are the app. The SDK (`@kakushi/sdk`, `@kakushi/fhe-sdk`) and the drop-in `<KakushiPay>` widget (`@kakushi/widget`) are the plugin for other apps.

**Live:** https://kakushi.vercel.app, on Monad testnet (10143) plus Ethereum Sepolia (11155111). Evidence is in [SUBMISSION](SUBMISSION.md); sponsor status is in [SPONSOR-COVERAGE](docs/SPONSOR-COVERAGE.md).

## What works live

Every row below is a real transaction on a public testnet. It was run by a script in `scripts/`, and the output is saved in `docs/evidence/`.

| Flow | Result | Script |
| --- | --- | --- |
| Stealth send + scan | The receipt arrives in 431 ms. Proposed 431, Voted 725, Finalized 1020, Verified 1933 ms. The scanner finds the payment, and the derived key controls it. | `smoke-testnet.ts` |
| Shield + ZK withdraw to a fresh address | 0.1 MON in, then out with an UltraHonk proof (6.2M gas on Monad) | `smoke-testnet.ts` |
| Gasless withdraw through the relayer | Sepolia: a never-funded address receives 0.0009 ETH. The relayer's key pays, reached through the app's own proxy. | `smoke-relay-testnet.ts` |
| Bridge Monad → Sepolia, Sepolia → Monad | A Maker pays the exact quote in 23 s and 11.3 s | `smoke-bridge-testnet.ts` |
| Chainlink CRE simulate against live state | CRE CLI computes the next contiguous Sepolia window | `docs/evidence/cre-simulate-attest-sepolia-testnet.txt` |
| Confidential (FHE), 8 steps | Wrap, encrypted pay to a stealth address, scan, stealth-key decrypt, move, encrypted pay, KMS cash-out, pay link | `fhe-stealth-e2e.ts --testnet` |
| Privy policy wallet | The Maker's Privy server wallet signs an allowed approve (it lands), and Privy refuses a transfer out | `privy-proof-testnet.ts` |

## Architecture

| Piece | Where | Runs on |
| --- | --- | --- |
| App (Next.js 16) | `packages/app` | Vercel |
| Contracts: stealth, shielded pools + factory, private-call executor, bridge hub (EBC, MDC, DisputeModule, AttestationOracle) and routers | `packages/contracts` (Foundry), `packages/zk` (Noir) | Monad testnet, Sepolia |
| FHE contracts, engine, coprocessor, gateway, KMS | `fhe/` (its own pnpm workspace) | Monad testnet; engine + gateway on Railway |
| Relayer (gasless withdrawals; refuses fees below its gas cost) | `packages/relayer` | Railway |
| Maker 1 (fills bridge transfers; local key, or a policy-fenced Privy server wallet) | `packages/maker` | Railway |
| Attester (Chainlink CRE logic through the MockKeystoneForwarder; not a DON) | `packages/cre` | Railway |
| Watchtower (proves a missed payout and slashes the Maker's margin) | `packages/watchtower` | Railway |
| Indexer (transfers, Makers, attestations) | `packages/indexer` | Railway |

All Railway services build from `deploy/*.Dockerfile`. Keys live only in the hosts' environment variables. The app reaches each service through `/api/svc/<name>`, so the browser talks to a single origin.

## Testnet addresses

**Monad testnet (10143)**
- Hub: DisputeModule `0xE701a71Ec80Db1e50fbA55fC902CBc8919dD3aF9`, EBC `0x4AeceD018b464d4870872935CdF47039D3A53ECf`, MDC `0xe12c7c7da94fE211AaAD848fd2919714C96988A2`, AttestationOracle `0xc50A536E04DA4E2385e66fCf211820438F4905Da`, PayoutRouter `0x8187a35540972150A02c884048bF2F6B6aa7D1C1`, SourceRouter `0xB1d06c6E0464dE3C28DB5bb1bb9313F2037C8707`.
- Privacy: StealthRegistry `0x8777bf242EEe2112BA9185FB6571604dFD543A62`, StealthAnnouncer `0x7030628079Ce422c905DD819ba6ad95B562d66Aa`, StealthPay `0x0f650e5bC29242eBc107CA7B879d33c4EE4f4B04`, KakushiPoolFactory `0x2DfB49d4BDE2adF332407fe47dF835477a1Ecb3f` (pools: 0.1 MON `0x5f859405D69F24385C0Cf2297a6b2D4c91be2950`, 1 USDC `0xD1f5598c3A5e6250D2f6448bD5e2D9e3d3954E2B`).
- FHE: KakushiRegistry `0x0047D047510cd9201470c7Eb85cE0FdF69d7De90`, executor `0x632871F641F89ef095eE721c49B1F75b95471010`, cUSDC `0x18567b9fa61E7322f8d4111c7606107C7eEb55a1`, cAUSD `0x215032585515b2d55aB53Cb1b088deC0f75E4c77`, ConfidentialStealthPay `0x0b1fffD49Ccd2BcBDe14359C9435185A1607F7C6`.
- All 29 contracts are verified on MonadVision (Sourcify).

**Ethereum Sepolia (11155111)**
- PayoutRouter and SourceRouter at the same addresses as on Monad.
- StealthRegistry `0x8777…3A62`, StealthAnnouncer `0x7030…66Aa`, StealthPay `0x0f65…4B04`.
- KakushiPoolFactory `0x07dB2d8828E055B4ee8e15578e9575edFA387a5A` (pools: 0.001 ETH `0x01c494922333c7bb0C268BDcda1Ac218981a5F48`, 1 USDC `0x68110aE99EC4653628aB6FD3C92637678d8D97f8`).
- 15/15 verified on Sourcify.

Base, Arbitrum and OP Sepolia are built and tested on forks and are **awaiting funding** on testnet.

Machine-readable records are in `config/generated/*.testnet.json`. Redeploy with `node scripts/deploy-testnet.ts` (a dry run by default; idempotent and resumable).

## Run it locally

Requirements: Node 22.18+, pnpm 10.29.2, Foundry, and the pinned Noir toolchain.

1. `pnpm install --frozen-lockfile`
2. `pnpm stack:up && pnpm deploy:local`: three pruned anvil forks (Monad 18710, Sepolia 18711, Base Sepolia 18712), with the contracts deployed on them.
3. `pnpm fhe:up`: the FHE core plus cUSDC/cAUSD on the Monad fork; engine on 8899, gateway on 8890.
4. `pnpm dev`: the app on 3710.
5. Tests:
   - `pnpm demo`: the bridge scenarios, including a slashed Maker and a ZK proof;
   - `pnpm fhe:e2e`;
   - `pnpm test`, `pnpm contracts:test`, `pnpm zk:test`.
6. `pnpm stack:down` / `pnpm fhe:down` stop exactly the tracked PIDs.

CI (`.github/workflows/ci.yml`) runs the TypeScript, Solidity, Noir, CRE and `fhe-*` jobs on every push.

## Honest limits

- **The attester is not a Chainlink DON.** It runs the CRE workflow's logic through Chainlink's `MockKeystoneForwarder`, which checks no signatures, so attestations are trusted from Kakushi's runner.
- **FHE key custody.** One hosted engine holds the FHE key, and the 2-of-3 KMS signers run in one service.
- **Slashing on testnet.** It has run end to end only on a local fork (no testnet Maker has failed to pay).
- **Stealth delivery over the bridge.** It is built but not yet run live.
- **Gasless on Monad is uneconomic at today's testnet gas.** An UltraHonk withdraw is ~6.2M gas, about 0.9 MON. That is more than the 0.1 MON note, so the app offers self-withdraw instead. On Sepolia, gasless costs 10% of the note.
- **Envio is offline-tested only.** The HyperIndex package is built and tested but not on Envio Cloud; the live app uses Kakushi's own RPC indexer.
- **Cleanverse needs onboarding.** The compliance gate waits on Cleanverse's canonical ABI.
- **AUSD has no live transaction.** cAUSD is deployed, but the live FHE run used cUSDC.
