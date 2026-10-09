# Evidence: what was verified and how (2026-10-09)

Environment: the local Monad-testnet fork (anvil :18810, chain 10143), the Fhish gateway on :8890 and the engine on :8899, all already running. Node 26.5, Expo SDK 57.0.27, React Native 0.86.3.

## 1. App modules against the fork: `node scripts/verify-fork.ts` → 16/16 PASS

The full output is in [evidence/verify-fork.txt](evidence/verify-fork.txt). The script imports the app's own `src/lib/*` and `src/fhe/bridge.ts`. Encryption uses the **same `<script>`** the WebView runs, loaded in a Node `vm` context. Mera runs with a software WebAuthn authenticator that implements PRF (HMAC-SHA256 per credential); only the OS passkey sheet is simulated.

| Check | Result |
| --- | --- |
| tfhe encryptor page boots | wasm ready in ~30 ms |
| Mera: create passkey → address | yes |
| Mera: restore with **nothing stored** → **same address** | discoverable and pinned ceremonies both give the same address |
| Mera: `session.end()` zeroes the key | signing afterwards throws `SESSION_ENDED` |
| Encrypt on device + gateway attestation | pk 33,034 B, tfhe 4–5 ms, attest ~35 ms |
| AUSD faucet (sponsored) | +10,000 AUSD, `sync=true` (eth_sendRawTransactionSync) |
| Make private: ERC-3009 wrap submitted by sponsor | cAUSD +100, gas limit = estimate × 1.3, ladder Proposed → Voted → Finalized |
| Pay alice → bob (encrypted) | bob +12.50 (revealed by bob); amount **absent from calldata** |
| Privacy: alice cannot reveal bob's balance | gateway: `not allowed to decrypt` |
| Pay link create + URL round trip | `fhishpay://` and `https://` forms parse back to the same id and key |
| Pay link claimed by the **Mera account** with **0 MON** (sponsor submits) | revealed 7.25 cAUSD through Mera `toViemAccount().signTypedData` |
| Second claim refused | "Link #N was already claimed." |
| Cash out: unwrap + oracle callback | callback after ~2.9 s, bob AUSD +2.00 |
| Activity from on-chain events | sender and receiver sides |
| Monad heartbeat (`monadNewHeads`, real testnet, read-only) | Proposed / Voted / Finalized / Verified events received |

## 2. The UI, end to end, in the Expo web build (Metro :8081, 375×812 viewport)

Every flow was driven by clicking through the real UI on the fork. On web the encryptor runs in a sandboxed iframe with the same HTML string as the WebView, and reveal uses the same noble unseal.

| Flow | Observed |
| --- | --- |
| Onboarding | Passkey create/restore, DEV section (local only), network switch. [screenshot](evidence/1-onboarding.jpg) |
| DEV alice → Home → **Reveal** | Amber `$1,170.25`; live heartbeat "voted ~300 ms · final ~560 ms" from real Monad testnet. [screenshot](evidence/2-home-revealed.jpg) |
| Send **by link** 3.5 AUSD | encrypt 67 ms, attest 14 ms, receipt 663 ms (`sendRawTransactionSync`), Proposed 687 ms, Voted 1.87 s, Finalized 2.79 s. Link shown masked (`#k=0x••••`), with Share and Copy. |
| Sign out → open `http://localhost:8081/claim?net=local&id=8#k=…` | Claim screen with the amount hidden; "Create your account to claim". The key is dropped from the address bar. [screenshot](evidence/3-claim-link-no-account.jpg) |
| DEV bob → **Claim** → **Reveal** | Sponsored claim plus ladder (receipt 1.09 s, Finalized 3.17 s), balance revealed in amber. [screenshot](evidence/4-claimed-ladder.jpg) |
| **Cash out** 1.5 | encrypt 90 ms, request 1.16 s, KMS + oracle callback 2.94 s, "+$1.50", public AUSD 10,552.00 → 10,553.50 |
| **Activity** | Cashed out, cash-out requested, sent (handle), link claimed, link created, received, claimed link. [screenshot](evidence/5-activity.jpg) |
| **Add AUSD** | Faucet 10,000 (sponsored, ladder); ERC-3009 make private 100 (sponsored, gas limit 266,880 = est × 1.3, ladder) |
| **Send to address** 6.25 with a reference | encrypt 12 ms, attest 48 ms, send 993 ms. [screenshot](evidence/6-send-address.jpg) |
| **Session expiry** (`EXPO_PUBLIC_SESSION_MINUTES=0.25`) | Countdown chip; at 0 the "Session ended … key was wiped from memory" notice appears and the chip shows "Locked". The next action re-unlocks. A page reload also starts locked, since no key is stored. [screenshot](evidence/7-session-ended.jpg) After this run, revealed values are also hidden on lock. |

On the fork the ladder takes seconds because anvil mines one block per second. The heartbeat shows real Monad testnet commit timings, about 300 ms to Voted and about 560 ms to Finalized.

## 3. Build checks

- `npx tsc --noEmit`: clean (TypeScript 6.0.3, strict).
- `npx expo install --check`: "Dependencies are up to date" (SDK 57).
- `npx expo export --platform ios`: Hermes bundle compiled (`index-….hbc`, 5.9 MB, includes the 1.9 MB encryptor page and fonts).
- `npx expo export --platform web`: bundle compiled (4 MB).
- Export outputs went to `~/.fhish-pay-mobile/` and were deleted afterwards.

## 4. Not verified (and why)

- **Real passkeys on a device or simulator.** These need a development build plus an associated domain on a public HTTPS host with an AASA naming the Apple Team ID (see README, "Passkey domain"). Expo Go has no native passkey module, and the app detects this and says so. Building natively (`expo run:ios`: Pods, DerivedData) wasn't possible within the disk budget. The Mera integration code itself (`src/lib/wallet.ts`, real `@category-labs/mera` 0.2.0) is verified in section 1 with a software authenticator.
- **The tfhe encryptor inside an iOS WKWebView (Expo Go).** I booted an iPhone 17 Pro simulator (iOS 26.5) and tried to install the cached Expo Go 57.0.9, but `simctl install` hung for more than 7 minutes and the device reported no screen surface. I aborted, shut that simulator down and deleted the extracted app. The encryptor page itself is verified in Node (`vm`) and in Chromium (iframe). It relies only on `WebAssembly`, `DecompressionStream` (iOS 16.4+), `new Function` and `postMessage`.
- **Monad testnet transactions.** These were deliberately not sent (out of scope), and Fhish Pay isn't deployed there yet. Testnet reads and the WebSocket heartbeat were verified.
- **Android.** Not run.
