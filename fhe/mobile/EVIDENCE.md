# Evidence: what was verified and how (2026-10-09)

Environment: the local Monad-testnet fork (anvil :18810, chain 10143), the Kakushi gateway on :8890 and the engine on :8899, all already running. Node 26.5, Expo SDK 57.0.27, React Native 0.86.3.

## 1. App modules against the fork: `node scripts/verify-fork.ts` → 23/23 PASS

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
| Pay link create + URL round trip | `kakushipay://` and `https://` forms parse back to the same id and key |
| Pay link claimed by the **Mera account** with **0 MON** (sponsor submits) | revealed 7.25 cAUSD through Mera `toViemAccount().signTypedData` |
| Second claim refused | "Link #N was already claimed." |
| Cash out: unwrap + oracle callback | callback after ~2.9 s, bob AUSD +2.00 |
| **Request:** alice asks bob (encrypted) + link round trip | `kakushipay://` and `https://` request links parse back to the same id, block and memo; `keccak256("rent october")` equals the event's `ref`; the amount is absent from calldata; ladder Proposed → Voted → Finalized |
| **Request:** payer reveals the requested amount | bob (payer) and alice (payee) both reveal 9.75 from `requestDue` |
| **Request:** bob pays → alice reveals owed 0, balance +amount | owed 0.00 · alice +9.75 · bob −9.75 (each revealed by its owner) |
| **Request:** unaffordable request stays owed | request for bob's balance + 1,000: `payRequest` succeeds, nothing moves (both balances unchanged), still owed the full amount, still open |
| **Request:** cancelled by payee, then pay refused | status `Cancelled`; bob's pay → "This request is no longer open…" (decoded `RequestNotOpen`) |
| **Request:** role guards | bob cancels → "Only the person who sent this request can cancel it." · alice pays her own → "Only the person this request was sent to can pay it." · self-request → "Ask someone else…" |
| Activity from on-chain events | sender and receiver sides |
| Activity: requests on both sides | alice: `request-sent`, `request-paid`, `request-cancelled` (payee) · bob: `request-received`, `request-paid` (payer) |
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
| **Request money** (DEV bob asks alice for 42.50, "rent october", 7 days) | encrypt 77 ms, attest 221 ms, `requestPayment` 361 ms (sync receipt), Finalized 2.43 s; request #9 with its link and Share / Copy / Open. [screenshot](evidence/8-request-created.jpg) |
| Payee opens request #9 → **Reveal** | amber `$42.50` "still owed to you", memo "✓ matches the reference committed on-chain", Cancel / Copy link. [screenshot](evidence/9-request-payee-reveal.jpg) |
| Sign out → open `http://localhost:8081/request?net=local&id=9&b=…#m=rent%20october` | request screen with the amount as a handle, memo verified, "Sign in to see this request" with passkey create/restore and DEV accounts; the address bar is reset to `/`. [screenshot](evidence/10-request-link-opened.jpg) |
| DEV alice (payer) → **Reveal the amount** → **Pay $42.50** | amber `$42.50` "You owe" [screenshot](evidence/11-request-payer-reveal.jpg); pay 598 ms (sync), Finalized 2.73 s, automatic re-reveal 1.86 s → `$0.00`, "Paid · nothing is owed". [screenshot](evidence/12-request-paid-ladder.jpg) Revisiting it later and revealing shows "Nothing owed" with a "settled · only you two know" chip and no Pay button. [screenshot](evidence/14-request-settled.jpg) |
| Unaffordable request (`node scripts/make-request.ts 250000 "school fees"`, alice holds ~2,000 cAUSD) → **Pay** | tx succeeds, re-reveal still `$250,000.00`, calm "Nothing moved, and that's fine" note, request stays open. [screenshot](evidence/13-request-balance-short.jpg) |
| **Activity** (alice) | "Request for you #13", "You paid on request #13 · moves in full or not at all", "You paid on request #9"; tapping a request opens its screen. [screenshot](evidence/15-activity-requests.jpg) |
| Payee **Cancel** (request #4, from Activity) | cancel 779 ms (sync), Finalized 2.94 s, status chip "cancelled", Cancel and Copy link removed. [screenshot](evidence/16-request-cancelled.jpg) |
| **Session expiry** (`EXPO_PUBLIC_SESSION_MINUTES=0.25`) | Countdown chip; at 0 the "Session ended … key was wiped from memory" notice appears and the chip shows "Locked". The next action re-unlocks. A page reload also starts locked, since no key is stored. [screenshot](evidence/7-session-ended.jpg) After this run, revealed values are also hidden on lock. |

On the fork the ladder takes seconds because anvil mines one block per second. The heartbeat shows real Monad testnet commit timings, about 300 ms to Voted and about 560 ms to Finalized.

Activity got faster with this change. It used to run one 100-block-paged `eth_getLogs` scan per event and filter, about 2,900 calls, and took **107 s** on the fork (blocks before the fork point are fetched from Monad testnet). Now it reads every cAUSD log in one paged pass, 6 pages in flight, and filters on the device: **17 s** on its first run (a few seconds once anvil has cached the forked ranges), and the whole verify run dropped from more than 10 min to 33 s. For two accounts, a comparison script confirmed that the old and new implementations return identical non-request items in identical order (24/24 and 22/22).

## 3. Build checks

- `npx tsc --noEmit`: clean (TypeScript 6.0.3, strict), including after the payment-request change.
- `npx expo install --check`: "Dependencies are up to date" (SDK 57).
- `npx expo export --platform ios`: Hermes bundle compiled (`index-….hbc`, 5.9 MB, includes the 1.9 MB encryptor page and fonts).
- `npx expo export --platform web`: bundle compiled (4 MB).
- Export outputs went to `~/.kakushi-pay-mobile/` and were deleted afterwards.

## 4. Not verified (and why)

- **Real passkeys on a device or simulator.** These need a development build plus an associated domain on a public HTTPS host with an AASA naming the Apple Team ID (see README, "Passkey domain"). Expo Go has no native passkey module, and the app detects this and says so. Building natively (`expo run:ios`: Pods, DerivedData) wasn't possible within the disk budget. The Mera integration code itself (`src/lib/wallet.ts`, real `@category-labs/mera` 0.2.0) is verified in section 1 with a software authenticator.
- **The tfhe encryptor inside an iOS WKWebView (Expo Go).** I booted an iPhone 17 Pro simulator (iOS 26.5) and tried to install the cached Expo Go 57.0.9, but `simctl install` hung for more than 7 minutes and the device reported no screen surface. I aborted, shut that simulator down and deleted the extracted app. The encryptor page itself is verified in Node (`vm`) and in Chromium (iframe). It relies only on `WebAssembly`, `DecompressionStream` (iOS 16.4+), `new Function` and `postMessage`.
- **Monad testnet transactions.** These were deliberately not sent (out of scope), and Kakushi Confidential isn't deployed there yet. Testnet reads and the WebSocket heartbeat were verified.
- **Android.** Not run.
- **Payment requests on a device.** Request links were exercised in the Expo web build (`http://localhost:8081/request?…`) and in Node, but not in the native app. The `kakushipay://request` scheme, the iOS `applinks` `/request*` entry and the Android `/request` intent filter are configured but not tested natively, for the same reasons as above.
- **Scanning a payer's QR code.** Not built. It would need `expo-camera`, a new native module, and this pass added no packages. The payer field has **Paste**, which extracts the first `0x…` address from the clipboard.
- The fork is shared with another agent's work, so request ids and Activity contents include their transactions. The balance-delta checks read each account's balance right before and after its own transaction, and they passed on two full runs.
