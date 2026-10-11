# Kakushi Confidential (FHE) on Monad

> Formerly **Fhish**: this directory is the FHE half of [Kakushi](../README.md), the privacy provider for
> Monad. The ZK half (stealth addresses, shielded pool, private calls, private bridge) lives in
> `../packages`. `fhe/` is its own pnpm workspace with its own lockfile; run its commands from here.

**Confidential payments infrastructure for Monad.** Kakushi's FHE engine is a fully homomorphic encryption network
built for Monad: balances and amounts stay encrypted on-chain while contracts still compute on them.
**Kakushi Confidential** is the product on top: real stablecoins (Agora AUSD, Circle USDC) whose every balance,
payment, salary and pay link is a ciphertext. The chain sees who paid whom and when; never how much. Pay a
**private recipient** (Kakushi's ZK-side stealth addresses) and it no longer sees who either; see
[One app, both engines](#one-app-both-engines).
(Not to be confused with "Kakushi Pay", the ZK side's drop-in payment widget.)

| Kakushi Confidential | What happens on-chain |
|---|---|
| Make AUSD private (one signature, gas sponsored) | `wrapWithAuthorization` (ERC-3009): a public deposit becomes an encrypted balance |
| Pay a friend | `pay(to, encryptedAmount, proof, ref)`: both balances updated homomorphically |
| Send across borders by link | `createLink` escrows an encrypted amount behind a one-time key; the recipient creates a passkey account and `claimLink`s it, gasless |
| Request money (an invoice) | `requestPayment(payer, encryptedAmount, …)`: only payee and payer can read it; `payRequest` pays it; what is still owed is itself a ciphertext |
| Run payroll | `runPayroll` / `runPayrollFrom` (a relaying operator that can only submit batches the employer signed, each reference once): one tx, one ciphertext per salary |
| See your balance | EIP-712 request; the value is sealed to a key only your device holds |
| Cash out | `unwrap`: only the amount you take out is revealed, after Monad finality |

Every step settles in under a second on Monad, and the apps show it: **Proposed → Voted → Finalized
→ Verified**, streamed from Monad's `monadNewHeads` subscription.

Any contract can use the same machinery in two lines:

```solidity
import {FHE} from "@kakushi/fhe/lib/FHE.sol";
import {KakushiConfig} from "@kakushi/fhe/KakushiConfig.sol";

contract SealedBid is KakushiConfig {
    euint64 highest;
    function bid(externalEuint64 x, bytes calldata proof) external {
        euint64 b = FHE.fromExternal(x, proof);
        highest = FHE.allowThis(FHE.max(highest, b));       // computed on ciphertext
    }
}
```

The API mirrors Zama's `FHE.sol` (`euint64`, `externalEuint64`, `fromExternal`, `allow`/`allowThis`,
`select`, `requestDecryption`), so fhEVM and ERC-7984 code ports with an import change.

---

## What is real

Everything below runs, nothing is mocked:

- **Real FHE.** Ciphertexts are Zama **tfhe-rs 1.8.1** (TFHE, 128-bit security parameters), computed
  by a native multi-threaded engine (`engine/`, Rust). Browsers encrypt with the same library compiled
  to WASM with a thread pool.
- **Real money, real Monad state.** The end-to-end suite runs on a fork of Monad testnet. It takes
  **real Agora AUSD** from Agora's own faucet contract and wraps it gaslessly. It runs encrypted
  payroll, claims a pay link from a brand-new account and cashes out real AUSD. It also wraps
  **real Circle USDC**, and can deliver every decryption through **Chainlink's KeystoneForwarder**,
  which already lives on Monad testnet.
- **Real Monad finality.** `sdk/src/monad.ts` is tested live against Monad testnet: a block goes
  Proposed → Voted → Finalized in well under a second.
- **One command proves it:** `pnpm e2e` (or `pnpm e2e --deliver cre`). See [Results](#results).

Honest limits are in [Trust model](#trust-model) and [DEPLOY-LATER.md](DEPLOY-LATER.md).

---

## Architecture

```
 browser / node                     Monad (300 ms blocks)                     Kakushi network
 ───────────────                    ─────────────────────                     ─────────────
 tfhe WASM encrypt ──► gateway ──── k-of-n input attestation (EIP-712) ──┐
                       /inputs                                            │
 user tx ───────────────────────► your contract                           │
                                    │ FHE.add / select / gt …             │
                                    ▼                                     │
                                  KakushiExecutor  ── ACL check per operand │
                                    │ emits FheOp(op, result, lhs, rhs)   │
                                    │ (symbolic: handles only)            ▼
                                    │                         coprocessor: parallel op graph
                                    │                         ──► kakushi-fhe-engine (tfhe-rs, native)
                                    │                              real ciphertexts per handle
                                    ▼
                         FHE.requestDecryption(handles, cb)
                                  KakushiDecryptionOracle ◄── KMS k-of-n signs DecryptionResult
                                    │                   ◄── delivered by Chainlink CRE (onReport)
                                    ▼                       or the relayer (fulfill)
                         your contract.cb(requestId, cleartexts)   ← automatic callback
```

| Layer | Where | What it does |
|---|---|---|
| `FHE.sol` | `contracts/src/lib` | The library contracts call. Ops return new handles (32 bytes, last byte = type). |
| `KakushiExecutor` | `contracts/src/lib` | Checks the ACL on every operand, derives the result handle, emits the op. No FHE on-chain, so ops cost ordinary gas. |
| `KakushiACL` | `contracts/src/lib` | Persistent grants plus **transient** grants in EIP-1153 storage (free within a tx). |
| `KakushiInputVerifier` | `contracts/src/lib` | k-of-n EIP-712 `InputAttestation(handle, user, contract)`: an input only works for the user and contract it was encrypted for. |
| `KakushiDecryptionOracle` | `contracts/src/oracle` | Public reveals with **automatic callbacks**, k-of-n KMS signatures, Chainlink CRE `onReport`. |
| `ConfidentialPayments` | `contracts/src/apps` | Kakushi Confidential: private pay with references, pay links claimable by a one-time key (front-run-proof, refundable), encrypted payment requests, encrypted payroll (operators relay only employer-signed EIP-712 batches, one payment per reference), gasless onboarding via ERC-2612 / ERC-3009. Wraps any ERC-20 (AUSD, USDC). |
| `KakushiRegistry` | `contracts/src/lib` | CREATE3 via CreateX: **the same address on every chain** (`0xEc4A6767F7884712C0B19ada05F9C98e5fd341E7`). `KakushiConfig` reads it, which makes the integration one inheritance. |
| kakushi-fhe-engine | `engine/` | Rust + axum over tfhe-rs 1.8.1: keygen, input validation, every op, select, random, decrypt. |
| coprocessor | `coprocessor/` | Follows the executor's events and schedules the op graph in parallel, respecting handle dependencies. Gateway (inputs, sealed user decryption), KMS, metrics. |
| CRE workflow | `cre/` | `kakushi-fhe-decrypt-relay`: log trigger per request + cron sweep, HTTP fetch with DON consensus, `writeReport` to the oracle. |
| SDK | `sdk/` | `KakushiFheClient.encrypt / userDecrypt / waitForDecryption`. Encryptors: Zama `node-tfhe` (Node, pure JS, ~40 ms), the engine CLI, and `tfhe` WASM with a thread pool (browser). |
| MetaMask plugin | `plugins/mm-kakushi/` | `mm kakushi …`: confidential trading for the MetaMask Agent Wallet (dark OTC, sealed bids, confidential USDC). |
| Skills | `skills/` | Agent skills: write confidential contracts, use the SDK, operate the network. |
| Kakushi Confidential web | `app/` | `/pay` (send, pay links, reveal, cash out), `/pay/employer` (encrypted payroll, operator + scheduled runs), `/claim`, `/activity` (Envio), live Monad heartbeat; Privy (embedded wallet, gas sponsorship, server wallet + policy). Plus the playground, developer docs and metrics. |
| Kakushi Confidential mobile | `mobile/` | Expo app for Agora's bounty: Mera passkey accounts, AUSD faucet, gasless private wrap, encrypted sends and pay links, claim, reveal, cash out, settlement ladder. tfhe runs in a hidden WebView (Hermes has no WebAssembly). |
| Indexer | `indexer/` | Envio HyperIndex over Kakushi Confidential, the oracle and the executor: payment graph without amounts, link lifecycle, payroll runs, reveal latency, public TVL. |

### Decryption, three ways

1. **Public reveal with callback** (auction winner, unwrap amount, OTC cross price):
   `FHE.requestDecryption(handles, this.cb.selector)` → the KMS checks the request on-chain, decrypts,
   signs → the oracle verifies k-of-n signatures → `cb(requestId, cleartexts)` runs. No second user
   transaction, no dApp babysitting.
2. **Sealed user decryption** (my balance, my bid): the user signs EIP-712
   `UserDecrypt(handles, contract, publicKey, expiresAt)`. The gateway checks the ACL for both the user
   and the contract, then returns the plaintext sealed to an ephemeral P-256 key that only the browser
   tab holds (ECDH → HKDF-SHA256 → AES-256-GCM). Nothing touches the chain.
3. **Chainlink CRE delivery**: the same signed result, delivered by a DON instead of a relayer key.
   The oracle re-verifies the KMS signatures, so CRE adds liveness without adding trust.

### Built for Monad

- **Speculative compute, final reveals.** On Monad the coprocessor subscribes to `monadLogs`, which
  streams executor events from blocks still at Proposed/Voted, and materializes ciphertexts from there
  (the 100-block poller remains the source of truth). Elsewhere it starts at `latest`, while the KMS signs a public decryption only once the request's block is
  `finalized` (Monad: ~2-3 blocks behind). The FHE work overlaps finality, so the gate usually costs
  nothing, and a reorged request can never leak a plaintext.
- **Gas is charged on the limit.** Ops are event-only on-chain; every Kakushi transaction (relayer,
  CRE runner, SDK examples) sets an explicit limit of estimate + 30%.
- **Commit states in the product.** `MonadHeads` subscribes to `monadNewHeads` and tracks a payment's
  block through Proposed → Voted → Finalized → Verified; `trackByTags` gives the same ladder from
  `latest`/`safe`/`finalized` on any RPC.
- **One round trip.** Fulfilment uses `eth_sendRawTransactionSync` (EIP-7966), falling back to
  send + poll where unsupported.
- **`eth_getLogs` ≤ 100 blocks.** All followers page in 100-block windows.
- **Parallel by dependency.** Monad executes independent transactions in parallel; the op graph does
  the same with ciphertexts, so different users' ops never queue behind each other.

---

## Kakushi FHE vs Zama vs Fhenix

| | **Kakushi (Monad)** | Zama Protocol | Fhenix CoFHE |
|---|---|---|---|
| FHE library | tfhe-rs 1.8.1 | tfhe-rs | TFHE (FHEOS) |
| Chain | Monad, 300 ms blocks | Ethereum mainnet | testnets |
| Public decryption | **automatic callback** (one tx) | removed in v0.9: client fetches + second tx | `decryptForTx`: client-driven |
| Request → plaintext on-chain | measured, see [Results](#results) | not published | not published |
| Coordination layer | Monad itself | Arbitrum gateway rollup | Threshold Network |
| Delivery | relayer or **Chainlink CRE** | relayer | relayer |
| Solidity API | Zama-compatible `FHE.sol` | `FHE.sol` | `FHE.sol` (own) |
| Integration | inherit `KakushiConfig` (CREATE3 registry, same address everywhere) | `SepoliaConfig` per chain | per chain |
| Gas on Monad (charged on limit) | ops are event-only; tight explicit gas limits everywhere | HCU metering with per-block SSTOREs | queue writes |
| KMS | k-of-n signers (configurable) | 13-node MPC in Nitro enclaves | threshold network |

Sources and caveats: [docs/research/COMPETITORS.md](docs/research/COMPETITORS.md). Zama's KMS is
more decentralized than ours today; we say so below.

---

## Results

All numbers below come from this repository on one laptop (Apple Silicon, 10 threads), with real
tfhe-rs ciphertexts on a fork of Monad testnet (`node scripts/e2e-local.ts --deliver cre`, 2026-10-09):

```
PASS  Sealed-bid auction               winner bob @ 1337; close -> callback 4950 ms; bob user-decrypted his bid = 1337; losing bids never decrypted
PASS  Confidential USDC (any ERC-20)   bob sees 20 cUSDC, alice 30 cUSDC, carol refused; bob unwrapped 5 real USDC
PASS  Dark OTC                         bob @3000 missed (nothing revealed), carol @3200 crossed at the maker's 3150
PASS  Kakushi Confidential on real AUSD           salaries 3,200 / 1,150 AUSD private; link 250 AUSD claimed by a new account; request paid (75) and an unaffordable one left open; carol refused bob's balance; bob cashed out 1,000 real AUSD
PASS  Chainlink CRE delivery           4/4 callbacks delivered by CRE reports through the KeystoneForwarder (KMS signatures re-verified on-chain)
```

**FHE latency** (coprocessor metrics, ms):

| Step | p50 | p95 |
|---|---|---|
| encrypt in the browser (WASM, multi-threaded) | 3–150 | |
| input attestation (engine validates + k-of-n sign) | 10 | 17 |
| `add` / `sub` on euint64 | 566–574 | |
| `ge` / `gt` | 183–279 | 347 |
| `select` | 297 | 365 |
| KMS public decryption (request seen → signed) | 655 | 656 |
| sealed user decryption | 8 | 74 |
| request seen → callback on-chain (relayer, `eth_sendRawTransactionSync`, includes the finality gate) | 1,171 | 2,172 |
| finality gate (wait until the request block is `finalized`) | 3–1,085 | 1,086 |
| request → callback through Chainlink CRE (local runner, 1 s fork blocks) | 0.8–3.3 s | |

Standalone engine benchmarks (`kakushi-fhe-engine`, tfhe-rs 1.8.1): keygen 1.9 s, encrypt ~6 ms,
add 174 ms, gt 103 ms, select 158 ms, max 275 ms when the machine is otherwise idle.

**Gas** (Foundry traces; Monad charges the gas *limit*, so every Kakushi transaction sets a tight
explicit limit):

| Call | Gas |
|---|---|
| executor binary op (add, gt, …) | 7.5k–12.4k |
| `select` | 9.0k–10.5k |
| trivial encrypt | 3.8k–6.3k |
| `verifyInput` (k-of-n EIP-712) | 16.5k–25k |
| `requestDecryption` | 28.6k |
| oracle `fulfill` / CRE `onReport` incl. callback | 28k–118k |
| `bid` (sealed auction) | ~293k |
| confidential ERC-20 `wrap` / `unwrap` | 212k / 337k |

Tests (all green on 2026-10-09):

| Suite | Result |
|---|---|
| Solidity (`forge test`): ACL, inputs, oracle, apps, pay links, requests, payroll signatures/replay/expiry, 64-bit supply bound | 18 / 18 |
| TypeScript (`pnpm -r test`): CRE core, coprocessor op graph + sealing + monadLogs, SDK client + live Monad commit states | 21 / 21 |
| Fork e2e (`pnpm e2e`, also `--deliver cre`) | 4 / 4 scenarios |
| Web flows through the app's routes (`app/scripts/pay-e2e.ts`) | 8 / 8 |
| Mobile modules on the fork (`mobile/scripts/verify-fork.ts`) | 25 / 25 |
| Indexer handlers (`indexer`, vitest) and chain recount (`indexer/scripts/verify.ts`) | 7 / 7, ALL MATCH |
| Indexer-backed feeds equal log-derived feeds (`app/scripts/activity-parity.ts`, verify-fork) | parity OK |

---

## Trust model

Stated plainly, because a new FHE network starts less decentralized than Zama:

- **FHE secret key.** One engine holds the TFHE client key. Ciphertexts on-chain reveal nothing, but
  that operator could decrypt. *Roadmap:* threshold-share the key (tfhe-rs supports it; Zama's KMS
  does this with MPC).
- **KMS and input signers.** k-of-n EIP-712 signers, rotatable by the owner. In the local stack the n
  keys live in one process (`DEMO ASSUMPTION`, marked in `coprocessor/src/kms.ts`); in production each
  is an independent operator.
- **Correctness of computation.** The coprocessor re-executes the public op graph. Anyone with the
  server key can re-run it and compare. No proofs of correct FHE evaluation yet.
- **Inputs.** Attested by k-of-n signers after the engine validates the ciphertext list. Zama uses a
  ZK proof of knowledge instead; adding ZKPoK is on the roadmap.
- **CRE delivery.** Cannot forge results: the oracle checks the KMS signatures. It can only delay
  them, and the relayer path stays available as a fallback.

---

## Run it

Requirements: Node ≥ 22.18, pnpm 10, Foundry, Rust (stable), and the `cre` CLI for the workflow build.

```bash
pnpm install
pnpm engine:build && mkdir -p engine/bin && cp engine/target/release/kakushi-fhe-engine engine/bin/
pnpm contracts:test                                               # Solidity tests
pnpm e2e                                                          # fork + engine + deploy + 4 scenarios (incl. Kakushi Confidential on real AUSD)
pnpm e2e --deliver cre                                            # same, every callback through Chainlink CRE
node scripts/e2e-local.ts --keep --deliver cre                    # keep the stack up for the app
pnpm --filter @kakushi/fhe-app dev                                      # http://localhost:3810 (/pay, /pay/employer, /activity)
node app/scripts/pay-e2e.ts                                       # every web flow through the app's routes
cd mobile && sh scripts/install-deps.sh && node scripts/verify-fork.ts   # mobile: 16 checks on the fork; npx expo start
cd indexer && pnpm install && node scripts/configure.ts           # then envio start (indexer/README.md); scripts/verify.ts
```

| Service | Port |
|---|---|
| anvil fork of Monad testnet | 18810 |
| kakushi-fhe-engine | 8899 |
| coprocessor + gateway | 8890 |
| local CRE runner | 8891 |
| app (Kakushi Confidential web) | 3810 |
| indexer GraphQL (Hasura) / Postgres / Envio indexer | 8892 / 5442 / 9908 |

These do not overlap the ZK side of the monorepo (anvils 18710-18714, app and services 3710-3715,
4201), so both stacks can run at once.

Environment variables use the `KAKUSHI_FHE_` prefix (`KAKUSHI_FHE_NETWORK`, `KAKUSHI_FHE_GATEWAY_URL`,
`KAKUSHI_FHE_RPC_URL`, `KAKUSHI_FHE_OFFLINE`, ...). Local state (engine keys, follower cursors) lives in
`.kakushi-fhe/` (gitignored); signer keys in `.secrets/` (gitignored).

### One app, both engines

The Kakushi app (`../packages/app`) runs Kakushi Confidential at `/confidential` on the same local
Monad fork as the ZK contracts (:18710), next to Send / Receive / Shield / Bridge:

```bash
# from the repository root, after pnpm stack:up && pnpm deploy:local
node scripts/fhe-local.ts up       # FHE core + cUSDC/cAUSD over the fork's real USDC/AUSD + ConfidentialStealthPay,
                                   # engine :8899 + gateway :8890 (PIDs in .stack/demo-pids), config/generated/fhe.local.json
node scripts/fhe-stealth-e2e.ts    # wrap -> encrypted pay to a stealth address -> scan -> stealth-key reveal -> move -> reveal
node scripts/fhe-local.ts down     # stops exactly the PIDs it started
```

`ConfidentialStealthPay` (`contracts/src/apps`) moves an encrypted amount to an ERC-5564 stealth address,
forwards native gas to it and announces it on Kakushi's StealthAnnouncer with FHE metadata
(`0xfe0000fe`, the confidential token, the encrypted amount's handle; documented in
`packages/sdk/src/stealth.ts`). The recipient's inbox reveals the amount with the stealth private key and
moves the encrypted balance to their main wallet without ever decrypting it.

### Use it in your contract

```bash
forge install nickthelegend/kakushi
# remappings.txt: @kakushi/fhe/=lib/kakushi/fhe/contracts/src/
```

Then follow [skills/kakushi-confidential-contracts/SKILL.md](skills/kakushi-confidential-contracts/SKILL.md).
Ready-made apps: `ConfidentialToken` (ERC-7984-shaped), `ConfidentialERC20Wrapper` (wrap any ERC-20),
`SealedBidAuction`, `ConfidentialVoting`, `DarkOTC`, and `ConfidentialPayments` (`KakushiPayToken`: payments,
pay links, payroll, gasless onboarding over any ERC-20).

---

## Attribution and disclosure

- **Pre-existing work by the author.** This FHE stack was developed as **Fhish** and renamed when it
  merged into Kakushi (history kept: `git log -- fhe/`). It began as multichain FHE experiments in the
  [fhish-tech](https://github.com/fhish-tech) organization (Flare, Stellar, Algorand). Their symbolic
  coprocessor pattern informed this design. This repository is a new implementation for Monad
  written during Metropolis: the contracts, the native engine, the parallel coprocessor, the KMS,
  the CRE workflow, the SDK, the skills, the web and mobile apps and the indexer.
- **External code.** [Zama tfhe-rs](https://github.com/zama-ai/tfhe-rs) 1.8.1 (Rust, and the `tfhe`
  WASM package in the browser). Foundry and forge-std. [CreateX](https://github.com/pcaversaccio/createx)
  (deployed factory) for CREATE3. Chainlink CRE SDK 1.22 and CLI. MetaMask Agent Wallet 7.1 (plugin host; a peer
  dependency, not redistributed), oclif, esbuild. Privy SDKs, Mera (Category Labs), Expo / React Native, Envio HyperIndex, @noble
  crypto, viem, axum, tokio, Next.js, React, Tailwind. The Solidity API is modelled on Zama's `FHE.sol` interface; no Zama Solidity code is copied.
- **AI coding tools.** Built with Claude Code (Anthropic) as the coding agent.

## Repository

```
contracts/   Foundry: FHE.sol, executor, ACL, input verifier, oracle, registry, apps, tests, deploy
engine/      Rust: tfhe-rs 1.8.1 engine (HTTP) and CLI encryptor
coprocessor/ TypeScript: op-graph scheduler, gateway, KMS, metrics
cre/         Chainlink CRE workflow kakushi-fhe-decrypt-relay + local runner
sdk/         TypeScript client (Node + browser)
plugins/     mm-kakushi: MetaMask Agent Wallet plugin
app/         Next.js: Kakushi Confidential web (pay, payroll, claim, activity), playground, developers, metrics
mobile/      Expo: Kakushi Confidential mobile (Mera passkeys, AUSD)
indexer/     Envio HyperIndex
skills/      Agent skills
scripts/     e2e-local.ts
docs/        research
```

Kakushi's code is MIT licensed. The FHE library is [Zama tfhe-rs](https://github.com/zama-ai/tfhe-rs)
(BSD-3-Clause-Clear). Zama's terms allow development, research and prototyping free of charge;
**commercial use of tfhe-rs needs a patent license from Zama.** A mainnet Kakushi FHE deployment must either obtain
that license or move to a different FHE backend; the engine's HTTP interface is the seam for that.
