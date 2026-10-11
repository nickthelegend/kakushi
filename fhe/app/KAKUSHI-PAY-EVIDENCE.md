# Kakushi Confidential web: verification evidence

Recorded 2026-10-09 on the local Monad-testnet fork (anvil `:18810`, chain 10143, 1 s blocks, `safe` = latest−1, `finalized` = latest−2), the Kakushi gateway (`:8890`) with real tfhe-rs, and the app dev server (`:3810`). cAUSD = `0x85c5dd61585773423e378146d4bec6f8d149e248` (KakushiPayToken over real Agora AUSD `0xa9012a05…22dC`). No Monad testnet transaction was sent. Privy credentials were not available, so everything below ran in local-fork mode; the Privy paths are compiled and typed but unexercised (see `PRIVY.md`).

## 1. Static checks

- `cd app && npx tsc --noEmit`: clean, including `scripts/*.ts` (added to `tsconfig.json`) and the Privy code typed against `@privy-io/react-auth` 3.48.0 and `@privy-io/node` 0.35.0.
- `node scripts/privy-setup.ts --network local --dry-run`: prints the policy (two ALLOW rules, `eth_signTransaction` and `eth_sendTransaction`, each requiring `to ∈ {cAUSD lower, checksummed}`, `chain_id == "10143"`, calldata `function_name == runPayrollFrom`, `current_unix_timestamp < notAfter`). Without credentials the real run exits 1 with setup instructions and calls nothing.
- `next build` was not run: the SSD had under 800 MB free and a production build would not fit next to the dev build.

## 2. Routes (curl, dev server)

| Route | Result |
| --- | --- |
| `/`, `/pay`, `/pay/employer`, `/claim`, `/playground`, `/developers`, `/metrics` | 200 |
| `GET /api/payroll/run` | 200: `{network:"local", operator:{address:0x14dC…9955, kind:"local-dev-key"}, privy:{serverWallet:false}}` |
| `POST /api/payroll/run` with a bad body | 400 `employer must be an address` |
| `POST /api/sponsor` `{}` | 400 `only cAUSD calls are sponsored` |
| `POST /api/faucet` (fresh address, `ausd:true`) | 200 `{"ausd":"10000"}` from Agora's real faucet contract on the fork |
| `GET /api/config` | 200, now with `pay.operator`, `pay.localSponsor`, `privy.{appIdConfigured,serverWallet,sponsor}` (no secrets) |

## 3. End-to-end through the app's routes: `node scripts/pay-e2e.ts`

Same contract calls the pages make, using the app's `/api/payroll/run`, `/api/sponsor` and `/api/faucet`; fresh random accounts for employees and the newcomer; native tfhe-rs encryptor.

```
Kakushi Confidential web flows on the local fork (34 s)
PASS  Wrap (ERC-2612 permit, one tx)             alice moved 2,000.00 AUSD into cAUSD with one signature + one tx (domain "Agora Dollar" v1)
PASS  Payroll from the employer's wallet         2 salaries in 1 tx; E1 reveals own salary 1,000.00; carol trying E1's salary: refused
PASS  Payroll by operator via /api/payroll/run   operator local-dev-key paid E2 750.00 (E2's own reveal); forged batch 401, unauthorized employer 409, replay 409
PASS  Pay link → new account (sponsored claim)   link #9: newcomer (0 MON) reveals 250.00; redirect attempt 502 (Execution reverted with reason: custom e…); non-claim call 403
PASS  Private payment with reference             carol reveals 42.00 from the Paid event; ref "Invoice 0042" is public
PASS  Cash out (unwrap via KMS callback)         E1 received 400.00 real AUSD 2158 ms after the request; private balance left 600.00

settlement ladders (local fork: latest / safe / finalized tags, 1 s blocks; ms after the receipt):
  wrapWithPermit   receipt  366 ms (eth_sendRawTransactionSync) · proposed 2 ms · voted 850 ms · finalized 1844 ms
  runPayroll       receipt  564 ms (eth_sendRawTransactionSync) · proposed 2 ms · voted 1136 ms · finalized 2122 ms
  setOperator      receipt  371 ms (eth_sendRawTransactionSync) · proposed 3 ms · voted 1111 ms · finalized 2033 ms
  setOperator      receipt  705 ms (eth_sendRawTransactionSync) · proposed 3 ms · voted 1131 ms · finalized 2160 ms
  runPayrollFrom   receipt  831 ms via the app's operator route · proposed 3 ms · voted 1121 ms · finalized 2160 ms
  createLink       receipt  373 ms (eth_sendRawTransactionSync) · proposed 2 ms · voted 1070 ms · finalized 2094 ms
  claimLink        receipt  701 ms via the app's sponsor route · proposed 12 ms · voted 1145 ms · finalized 2170 ms
  pay              receipt 1002 ms (eth_sendRawTransactionSync) · proposed 2 ms · voted 1012 ms · finalized 2042 ms
  unwrap           receipt  986 ms (eth_sendRawTransactionSync) · proposed 2 ms · voted 1068 ms · finalized 1994 ms
```

The fork's Voted/Finalized times reflect its 1 s blocks; real Monad numbers are in section 5.

## 4. In the browser (built-in browser pane, encryption by tfhe WASM in the page)

Driven on the real pages with local dev accounts (clicks dispatched from page scripts because the pane was not on screen):

| Flow | Observed |
| --- | --- |
| `/pay/employer` as Alice: Wrap 5,000 AUSD (permit + `wrapWithPermit`) | public AUSD 22,920 → 17,920; receipt 421 ms via `eth_sendRawTransactionSync`; ladder shown |
| Reveal my balance (EIP-712 user decryption) | `6,420.25` cAUSD shown, lantern-lit, only in that tab |
| Run payroll (Bob 3,200, Carol 1,150; 2 salaries encrypted in the browser) | one `runPayroll` tx; receipt 728 ms; ladder Proposed 753 ms, Voted 1,838 ms, Finalized 2,868 ms (from submit) |
| Authorize operator (`setOperator`, 30 days) → Run via operator now | salaries encrypted in the browser for the operator address, batch signed by Alice, submitted by `/api/payroll/run`; ladder final at 4,127 ms |
| Schedule (1 minute) | "Batch 8866fb279cd8 scheduled for 4:40:55 PM"; at 4:41:04 the page showed "ran on schedule" with its ladder (operator submitted while nothing was clicked) |
| `/pay` as Bob: Reveal my amounts | salary rows decrypted, e.g. `+3,200.00` for the funded run; later runs showed `+0.00` because Alice's encrypted balance was short (the contract pays 0 silently instead of reverting; the employer page now warns when a revealed balance is below the run total) |
| Pay link: 25 AUSD | link `/claim#id=6&k=0x…`, ladder final 2,323 ms |
| `/claim` in the same browser as a **new guest account** | link #6 from Bob, amount shown as a ciphertext handle; claim submitted by the fork sponsor (guest had no gas), receipt 875 ms; "Reveal what I received" → `25.00 AUSD`, balance `25.00 cAUSD`; the key was removed from the URL afterwards (`/claim#id=6`) |
| `/pay` as the guest: Cash out 10 | faucet gave fork gas; KMS revealed only 10; "Released 10.00 AUSD to your wallet"; public AUSD 0 → 10 |
| `/pay` as the guest: Pay 5 to Carol, ref "Coffee beans" | receipt 396 ms, ladder shown |

Layout checked with full-page headless Chrome screenshots at 1280 px and 390 px (landing, `/pay`, `/pay/employer`, `/claim`); the first 390 px pass showed horizontal overflow from grid min-content widths, fixed with `grid-cols-1` / `min-w-0`, and re-checked.

## 5. Monad heartbeat (live Monad testnet, read-only)

`MonadHeads` against `wss://testnet-rpc.monad.xyz` (`monadNewHeads`), rendered by `components/pay/Heartbeat.tsx` on the landing page and both Pay pages, even though the app itself runs on the fork. Observed in the page: "voted in ~297 ms · final in ~574 ms" (medians, Proposed → Voted / Finalized as seen by the browser), Verified about 1.5 s after Proposed, e.g. block 69523667: Proposed, Voted +281, Finalized +578, Verified +1517.

## Not verified

- Any Privy path: login, embedded wallet, `sponsor: true`, `useSignTransaction` on the fork, server wallet sends, policy enforcement. Requires the user's Privy app (`PRIVY.md`).
- Settlement ladder against Monad testnet itself (the testnet branch of `Settlement.tsx` uses `MonadHeads.track`); only the fork branch ran, and the heartbeat ran on live testnet data.
- `next build` (disk space).
