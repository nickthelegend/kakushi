# Privy in Kakushi Pay

Kakushi Pay uses Privy for more than login. Four Privy features carry real weight in the product:

| Privy feature | Where | What it does in Kakushi Pay |
| --- | --- | --- |
| Email / passkey login + **embedded wallet** | `src/lib/pay/privy-bridge.tsx` | Employer, employee and pay-link recipient sign in with an email or a passkey; an Ethereum embedded wallet is created on login (`createOnLogin: "users-without-wallets"`) on Monad testnet (10143). |
| **Native gas sponsorship** (`sponsor: true`, EIP-7702 + paymaster) | `privy-bridge.tsx` `send()` | Every user transaction (approve, wrap, pay, createLink, claimLink, runPayroll, setOperator, unwrap) goes through `useSendTransaction(..., { sponsor: true })`. A pay-link recipient who has never held MON claims their money. `msg.sender` stays the user's address, so Kakushi input proofs (bound to the sender) still verify. |
| **Server wallet** as payroll operator | `src/lib/pay/server-tx.ts`, `src/app/api/payroll/run/route.ts` | The employer authorizes a Privy server wallet on-chain (`setOperator(serverWallet, until)`); the server wallet then submits `runPayrollFrom(employer, …)` on schedule while the employer is offline. Sponsored on testnet (`privy.wallets().ethereum().sendTransaction(..., sponsor: true)`), or signed through `createViemAccount` and broadcast with `eth_sendRawTransactionSync`. |
| **Policy engine** | `src/lib/pay/policy.ts`, `scripts/privy-setup.ts` | The server wallet's policy allows only `eth_signTransaction` / `eth_sendTransaction` where `to` is cAUSD, `chain_id` is 10143, the calldata decodes to `runPayrollFrom`, and `current_unix_timestamp` is before a fixed date (optionally: only for listed employers). Everything else, including any transfer out, is denied by Privy's enclave before a signature exists. |
| EIP-712 signing with the embedded wallet | `privy-bridge.tsx` `signTypedData()` | "Reveal my balance / amounts" (Kakushi user decryption) and the employer's `PayrollBatch` authorization are one typed-data signature each. |

Defense in depth for automated payroll: (1) on-chain, the operator can only act for employers who called `setOperator` and only until `until`; (2) the API route only submits a batch the employer signed (EIP-712 `PayrollBatch`, verified with `verifyTypedData`, which also accepts ERC-1271 / EIP-7702 accounts), refuses replays and checks `operatorUntil` at the run time; (3) Privy's policy fences what the server wallet can sign at all. The salaries are encrypted in the employer's browser for the operator's address, so the server never sees an amount.

## Without credentials (today)

`NEXT_PUBLIC_PRIVY_APP_ID` is unset, so:

- every Kakushi Pay page shows a "Privy not configured" banner and offers the LOCAL ANVIL ONLY dev accounts (Alice, Bob, Carol) plus a "New guest account" (a fresh key kept in the browser, fork only);
- `@privy-io/react-auth` is not even bundled: `next.config.ts` aliases it to `src/lib/pay/privy-stub.ts` (types still come from the real package, so `tsc` checks the real Privy API);
- the payroll operator is a dev key (anvil #7) and pay-link claims are submitted by a local sponsor relayer (`/api/sponsor`, anvil #8, only `claimLink`); `/api/faucet` gives fresh fork accounts gas and test AUSD. All three refuse to run unless `KAKUSHI_FHE_NETWORK=local`.

## Setup (user actions)

1. **Create the app** at <https://dashboard.privy.io> (account creation is yours to do). Copy the **App ID** and **App secret** (App settings > Basics).
2. **Login methods**: enable **Email** and **Passkey** (User management > Authentication).
3. **Embedded wallets**: enable Ethereum embedded wallets. Native gas sponsorship requires **TEE execution**; new apps use it, older apps migrate per Privy's TEE migration guide.
4. **Allowed origins** (App settings > Domains): add `http://localhost:3810` and your deployed origin.
5. **Gas sponsorship** (Dashboard > Fee sponsorship): set up billing (prepaid credits; per the docs a saved payment method is only required for mainnets), turn on **Sponsor gas fees**, under **Supported chains** select **Monad Testnet**, and allow sponsored transactions **from the client** (the React SDK sends them).
6. **Server wallet + policy** (needs Kakushi Pay deployed to Monad testnet, i.e. `contracts/deployments/testnet-apps.json` with `causd`, see `DEPLOY-LATER.md`):

   ```bash
   cd app
   node scripts/privy-setup.ts --dry-run                       # print the policy, no API calls
   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/privy-setup.ts --network testnet --days 30
   #   optional: --employer 0xYourEmployer (restrict to these employers)
   #   optional: --owner-public-key <P-256 SPKI base64> so the app secret alone cannot change the wallet
   ```

   It creates the policy, then an Ethereum server wallet with `policy_ids: [policy]`, and prints the env lines below.
7. **Env** in `app/.env.local` (never commit it), then restart `next dev` (the `NEXT_PUBLIC_` value is inlined at start-up, and `next.config.ts` reads it to switch Privy on and cross-origin isolation off):

   ```bash
   KAKUSHI_FHE_NETWORK=testnet
   NEXT_PUBLIC_PRIVY_APP_ID=...
   # NEXT_PUBLIC_PRIVY_CLIENT_ID=...          # optional app client
   PRIVY_APP_SECRET=...
   PRIVY_PAYROLL_WALLET_ID=...               # from privy-setup.ts
   PRIVY_PAYROLL_WALLET_ADDRESS=0x...
   PRIVY_PAYROLL_POLICY_ID=...
   PRIVY_PAYROLL_SPONSOR=true                # Privy pays the operator's gas on Monad testnet
   # PRIVY_AUTHORIZATION_PRIVATE_KEY=...     # only if you used --owner-public-key
   ```

## Behaviour with credentials

| | Monad testnet (`KAKUSHI_FHE_NETWORK=testnet`) | Local fork + Privy |
| --- | --- | --- |
| User transactions | `useSendTransaction({…}, { sponsor: true })`, receipt via the app RPC | Privy embedded wallet signs (`useSignTransaction`), the app broadcasts to the fork with `eth_sendRawTransactionSync`; fork gas from `/api/faucet` (Privy's paymaster cannot reach a fork) |
| Payroll operator | Privy server wallet, sponsored | Privy server wallet, signed via `createViemAccount`, broadcast to the fork (set `PRIVY_PAYROLL_SPONSOR=false`; the wallet address needs fork MON) |
| Settlement ladder | `monadNewHeads`: Proposed, Voted, Finalized, Verified | block tags: latest, safe, finalized |
| Cross-origin isolation | off (Privy's iframe at auth.privy.io needs it off; tfhe WASM runs single-threaded) | off |

## Not verified yet (no credentials in this environment)

None of the Privy code paths have run against Privy: they compile against the real SDK types (`@privy-io/react-auth` 3.48.0, `@privy-io/node` 0.35.0) and follow the current docs, nothing more. Things to check on the first real run:

- that `useSignTransaction` returns the serialized signed transaction (the fork path throws a clear error if it returns only a signature);
- that sponsored server-wallet sends pass the policy (if Privy also asks the policy about an EIP-7702 authorization, add an `eth_sign7702Authorization` rule);
- ERC-2612 permits are not used with Privy wallets on purpose: an EIP-7702-upgraded account has code, and tokens that check ERC-1271 first would reject a plain ECDSA permit, so Kakushi Pay sends approve + wrap, both sponsored.
