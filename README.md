# Fhish on Monad

**Confidential payments infrastructure for Monad.** Fhish is a fully homomorphic encryption network
built for Monad: balances and amounts stay encrypted on-chain while contracts still compute on them.
**Fhish Pay** is the product on top: real stablecoins (Agora AUSD, Circle USDC) whose every balance,
payment, salary and pay link is a ciphertext. The chain sees who paid whom and when; never how much.

| Fhish Pay | What happens on-chain |
|---|---|
| Make AUSD private (one signature, gas sponsored) | `wrapWithAuthorization` (ERC-3009): a public deposit becomes an encrypted balance |
| Pay a friend | `pay(to, encryptedAmount, proof, ref)`: both balances updated homomorphically |
| Send across borders by link | `createLink` escrows an encrypted amount behind a one-time key; the recipient creates a passkey account and `claimLink`s it, gasless |
| Run payroll | `runPayroll` / `runPayrollFrom` (a policy-limited operator): one tx, one ciphertext per salary |
| See your balance | EIP-712 request; the value is sealed to a key only your device holds |
| Cash out | `unwrap`: only the amount you take out is revealed, after Monad finality |

Every step settles in under a second on Monad, and the apps show it: **Proposed → Voted → Finalized
→ Verified**, streamed from Monad's `monadNewHeads` subscription.

Any contract can use the same machinery in two lines:

```solidity
import {FHE} from "@fhish/lib/FHE.sol";
import {FhishConfig} from "@fhish/FhishConfig.sol";

contract SealedBid is FhishConfig {
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
 browser / node                     Monad (300 ms blocks)                     Fhish network
 ───────────────                    ─────────────────────                     ─────────────
 tfhe WASM encrypt ──► gateway ──── k-of-n input attestation (EIP-712) ──┐
                       /inputs                                            │
 user tx ───────────────────────► your contract                           │
                                    │ FHE.add / select / gt …             │
                                    ▼                                     │
                                  FhishExecutor  ── ACL check per operand │
                                    │ emits FheOp(op, result, lhs, rhs)   │
                                    │ (symbolic: handles only)            ▼
                                    │                         coprocessor: parallel op graph
                                    │                         ──► fhish-engine (tfhe-rs, native)
                                    │                              real ciphertexts per handle
                                    ▼
                         FHE.requestDecryption(handles, cb)
                                  FhishDecryptionOracle ◄── KMS k-of-n signs DecryptionResult
                                    │                   ◄── delivered by Chainlink CRE (onReport)
                                    ▼                       or the relayer (fulfill)
                         your contract.cb(requestId, cleartexts)   ← automatic callback
```

| Layer | Where | What it does |
|---|---|---|
| `FHE.sol` | `contracts/src/lib` | The library contracts call. Ops return new handles (32 bytes, last byte = type). |
| `FhishExecutor` | `contracts/src/lib` | Checks the ACL on every operand, derives the result handle, emits the op. No FHE on-chain, so ops cost ordinary gas. |
| `FhishACL` | `contracts/src/lib` | Persistent grants plus **transient** grants in EIP-1153 storage (free within a tx). |
| `FhishInputVerifier` | `contracts/src/lib` | k-of-n EIP-712 `InputAttestation(handle, user, contract)`: an input only works for the user and contract it was encrypted for. |
| `FhishDecryptionOracle` | `contracts/src/oracle` | Public reveals with **automatic callbacks**, k-of-n KMS signatures, Chainlink CRE `onReport`. |
| `ConfidentialPayments` | `contracts/src/apps` | Fhish Pay: private pay with references, pay links claimable by a one-time key (front-run-proof, refundable), encrypted payroll with operators, gasless onboarding via ERC-2612 / ERC-3009. Wraps any ERC-20 (AUSD, USDC). |
| `FhishRegistry` | `contracts/src/lib` | CREATE3 via CreateX: **the same address on every chain** (`0x2152Ed4dD179fCDe7FE0c2F35e274Ce4D7b0BaF9`). `FhishConfig` reads it, which makes the integration one inheritance. |
| fhish-engine | `engine/` | Rust + axum over tfhe-rs 1.8.1: keygen, input validation, every op, select, random, decrypt. |
| coprocessor | `coprocessor/` | Follows the executor's events and schedules the op graph in parallel, respecting handle dependencies. Gateway (inputs, sealed user decryption), KMS, metrics. |
| CRE workflow | `cre/` | `fhish-decrypt-relay`: log trigger per request + cron sweep, HTTP fetch with DON consensus, `writeReport` to the oracle. |
| SDK | `sdk/` | `FhishClient.encrypt / userDecrypt / waitForDecryption`. Encryptors: Zama `node-tfhe` (Node, pure JS, ~40 ms), the engine CLI, and `tfhe` WASM with a thread pool (browser). |
| MetaMask plugin | `plugins/mm-fhish/` | `mm fhish …`: confidential trading for the MetaMask Agent Wallet (dark OTC, sealed bids, confidential USDC). |
| Skills | `skills/` | Agent skills: write confidential contracts, use the SDK, operate the network. |
| App | `app/` | Landing page, live playground (real in-browser encryption), developer docs, live metrics. |

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

- **Speculative compute, final reveals.** The coprocessor materializes ciphertexts the moment ops
  appear at `latest`, while the KMS signs a public decryption only once the request's block is
  `finalized` (Monad: ~2-3 blocks behind). The FHE work overlaps finality, so the gate usually costs
  nothing, and a reorged request can never leak a plaintext.
- **Gas is charged on the limit.** Ops are event-only on-chain; every Fhish transaction (relayer,
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

## Fhish vs Zama vs Fhenix

| | **Fhish (Monad)** | Zama Protocol | Fhenix CoFHE |
|---|---|---|---|
| FHE library | tfhe-rs 1.8.1 | tfhe-rs | TFHE (FHEOS) |
| Chain | Monad, 300 ms blocks | Ethereum mainnet | testnets |
| Public decryption | **automatic callback** (one tx) | removed in v0.9: client fetches + second tx | `decryptForTx`: client-driven |
| Request → plaintext on-chain | measured, see [Results](#results) | not published | not published |
| Coordination layer | Monad itself | Arbitrum gateway rollup | Threshold Network |
| Delivery | relayer or **Chainlink CRE** | relayer | relayer |
| Solidity API | Zama-compatible `FHE.sol` | `FHE.sol` | `FHE.sol` (own) |
| Integration | inherit `FhishConfig` (CREATE3 registry, same address everywhere) | `SepoliaConfig` per chain | per chain |
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
PASS  Fhish Pay on real AUSD           salaries 3,200 / 1,150 AUSD private; link 250 AUSD claimed by a new account; carol refused bob's balance; bob cashed out 1,000 real AUSD
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

Standalone engine benchmarks (`fhish-engine`, tfhe-rs 1.8.1): keygen 1.9 s, encrypt ~6 ms,
add 174 ms, gt 103 ms, select 158 ms, max 275 ms when the machine is otherwise idle.

**Gas** (Foundry traces; Monad charges the gas *limit*, so every Fhish transaction sets a tight
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

Tests: 12 Solidity tests (`forge test`), 18 TypeScript tests (`pnpm -r test`: CRE core, coprocessor
op graph + sealing, SDK client, MetaMask plugin on the fork), typecheck of every package, and the e2e above in both delivery modes.

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
pnpm engine:build && mkdir -p engine/bin && cp engine/target/release/fhish-engine engine/bin/
pnpm contracts:test                                               # 12 Solidity tests
pnpm e2e                                                          # fork + engine + deploy + 3 scenarios
pnpm e2e --deliver cre                                            # same, every callback through Chainlink CRE
node scripts/e2e-local.ts --keep --deliver cre                    # keep the stack up for the app
pnpm --filter @fhish/app dev                                      # http://localhost:3810
```

| Service | Port |
|---|---|
| anvil fork of Monad testnet | 18810 |
| fhish-engine | 8899 |
| coprocessor + gateway | 8890 |
| local CRE runner | 8891 |
| app | 3810 |

### Use it in your contract

```bash
forge install fhish-tech/fhish-monad
# remappings.txt: @fhish/=lib/fhish-monad/contracts/src/
```

Then follow [skills/fhish-confidential-contracts/SKILL.md](skills/fhish-confidential-contracts/SKILL.md).
Ready-made apps: `ConfidentialToken` (ERC-7984-shaped), `ConfidentialERC20Wrapper` (wrap any ERC-20),
`SealedBidAuction`, `ConfidentialVoting`, `DarkOTC`.

---

## Attribution and disclosure

- **Pre-existing work by the author.** Fhish began as multichain FHE experiments in the
  [fhish-tech](https://github.com/fhish-tech) organization (Flare, Stellar, Algorand). Their symbolic
  coprocessor pattern informed this design. This repository is a new implementation for Monad
  written during Metropolis: the contracts, the native engine, the parallel coprocessor, the KMS,
  the CRE workflow, the SDK, the skills and the app.
- **External code.** [Zama tfhe-rs](https://github.com/zama-ai/tfhe-rs) 1.8.1 (Rust, and the `tfhe`
  WASM package in the browser). Foundry and forge-std. [CreateX](https://github.com/pcaversaccio/createx)
  (deployed factory) for CREATE3. Chainlink CRE SDK 1.22 and CLI. MetaMask Agent Wallet 7.1 (plugin host; a peer
  dependency, not redistributed), oclif, esbuild. viem, axum, tokio, Next.js, React, Tailwind. The Solidity API is modelled on Zama's `FHE.sol` interface; no Zama Solidity code is copied.
- **AI coding tools.** Built with Claude Code (Anthropic) as the coding agent.

## Repository

```
contracts/   Foundry: FHE.sol, executor, ACL, input verifier, oracle, registry, apps, tests, deploy
engine/      Rust: tfhe-rs 1.8.1 engine (HTTP) and CLI encryptor
coprocessor/ TypeScript: op-graph scheduler, gateway, KMS, metrics
cre/         Chainlink CRE workflow fhish-decrypt-relay + local runner
sdk/         TypeScript client (Node + browser)
plugins/     mm-fhish: MetaMask Agent Wallet plugin
app/         Next.js: landing, playground, developers, metrics
skills/      Agent skills
scripts/     e2e-local.ts
docs/        research
```

Fhish's code is MIT licensed. The FHE library is [Zama tfhe-rs](https://github.com/zama-ai/tfhe-rs)
(BSD-3-Clause-Clear). Zama's terms allow development, research and prototyping free of charge;
**commercial use of tfhe-rs needs a patent license from Zama.** A mainnet Fhish must either obtain
that license or move to a different FHE backend; the engine's HTTP interface is the seam for that.
