# Fhish Pay mobile

An Expo (React Native) app for sending **Agora AUSD** across borders **privately** on Monad. It targets the Monad Metropolis Agora bounty, "Best Cross-Border Payments App" (Track 2).

- **Mera passkey onboarding.** A passkey's WebAuthn PRF output becomes a BIP-39 phrase, then a BIP-44 EVM key, which lives only inside a Mera signing session. There's no seed phrase and no custody. The same passkey restores the same address on a fresh install, and nothing secret is stored on the phone.
- **Private amounts (Fhish FHE).** AUSD is wrapped 1:1 into cAUSD (`FhishPayToken`). Every send amount and every balance is ciphertext on-chain. Amounts are encrypted **on the phone** with Zama tfhe 1.8.1, and only the owner can reveal their own balance: an EIP-712 request whose reply is sealed to a one-shot P-256 key made on the device.
- **Request money (encrypted invoices).** Ask anyone, anywhere, for AUSD. The requested amount is encrypted on the phone; only the requester and the payer can ever read it, or what is still owed. The payer pays with one call, and whether a request has been settled is itself private.
- **Instant settlement.** After every transaction a ladder shows Proposed → Voted → Finalized (→ Verified on Monad) in milliseconds. A live **Monad heartbeat** shows real testnet blocks moving through commit states (`monadNewHeads`). Each transaction sets its gas limit to the estimate × 1.3, because Monad bills the limit, and is sent with `eth_sendRawTransactionSync` so the receipt comes back in one round trip.

## Screens

| Screen | What it does |
| --- | --- |
| Onboarding | "Create account with a passkey" (Mera) or "restore" (a discoverable passkey gives back the same address). On the **local fork only** it also offers a clearly labelled **DEV** section with Foundry's public anvil keys (alice, bob). |
| Home | Shows the encrypted cAUSD balance as a shimmering ciphertext handle; **Reveal** shows your number in amber. Also shows public AUSD, MON for gas, the actions (Send, **Request**, Add AUSD, Claim link, Cash out), and the Monad heartbeat. The session chip counts down; when it reaches 0 the key is wiped and the chip shows "Locked". |
| Add AUSD | Gets AUSD from Agora's faucet (`requestFunds`, 10,000 AUSD, 60 s global cooldown). **Make private** signs an ERC-3009 `ReceiveWithAuthorization` with no approve tx. On the fork a DEV sponsor submits it, so onboarding is gasless. |
| Send | Sends **to an address** or **by link**. The amount is encrypted on the device, then attested by the gateway, then signed and sent. The screen shows "what the chain sees" (the handle) and the settlement ladder. A link escrows the encrypted amount behind a one-time key and opens the share sheet. |
| Claim | Opens `fhishpay://claim?…#k=…` or `https://<host>/claim?…#k=…`. The amount stays hidden. If there's no account yet it offers to create or restore a passkey account. Claim, then the ladder, then **Reveal**. The link key signs `claimDigest(id, to)`, and anyone (the sponsor) may submit it. |
| Request money | Amount (encrypted on the device), the payer's address (typed or **Paste**), an optional reference such as "rent october", and an expiry (1 / 7 / 30 days). Encrypt, attest, `requestPayment`, then the settlement ladder. Shows "what the chain sees" and a **request link** with Share / Copy / Open. |
| Request #N | Opens from a request link (`fhishpay://request?net=…&id=…&b=…#m=…` or `https://<host>/request?…`) or from Activity. **Payer:** Reveal the amount (amber), **Pay**, the ladder, then the app re-reveals what is owed: `$0.00` and "settled" when it went through, or the same amount with a calm "nothing moved, your balance was short" note. **Payee:** Reveal what's still owed, **Cancel**, copy the link. Anyone else sees only the handle and "not addressed to you". Without an account it offers passkey create/restore. The memo from the link is shown with "✓ matches the reference committed on-chain" only when its keccak256 equals the event's `ref`. |
| Cash out | `unwrap(handle, proof)`: the KMS decrypts only that amount, the oracle callback pays the AUSD, and the step list shows it completing. |
| Activity | Built from `Paid`, `LinkCreated`, `LinkClaimed`, `LinkRefunded`, `Wrapped`, `UnwrapRequested`, `Unwrapped`, `PaymentRequested`, `RequestPaid` and `RequestCancelled` events (kinds `request-sent`, `request-received`, `request-paid`, `request-cancelled`, each with the viewer's role). Amounts appear as encrypted handles. Tapping a request opens it. `RequestPaid` is labelled "payment on request", never "paid in full": the outcome is private until one of the two parties reveals what is owed. Wrap and unwrap amounts are public by nature, because that's where value crosses the AUSD boundary. Logs are read in one paged pass over the contract (100-block pages, 6 in flight) and filtered on the device. |
| Account | Address, sign-in type, passkey domain, session (lock, unlock, sign out), network switch (Local fork / Monad testnet) and encryptor status. |

## How to run

The project disk is nearly full, so `node_modules` lives **outside** this folder. `mobile/node_modules` is a symlink to `~/.fhish-pay-mobile/node_modules`. Always install through the script, because a plain `npm install` would replace the symlink and write about 500 MB here:

```bash
cd mobile
sh scripts/install-deps.sh        # npm install in ~/.fhish-pay-mobile, symlink, build the tfhe encryptor
npm run sync:deployments          # copy addresses from ../contracts/deployments (local.json + local-apps.json)
npx tsc --noEmit                  # typecheck (scripts/ are Node-only and excluded)
node scripts/verify-fork.ts       # 23 checks of the app's modules against the local fork (see EVIDENCE.md)
```

Prerequisites: the local stack must be running. That means the anvil fork on `:18810`, the gateway on `:8890` and the engine on `:8899`.

UI:

```bash
npx expo start                    # Metro on :8081
#   w -> web (http://localhost:8081): full flow verified here with the DEV accounts
#   i -> iOS Simulator in Expo Go (Simulator reaches the Mac's 127.0.0.1)
```

- **Expo Go**: runs everything except passkeys, because Expo Go doesn't ship the native passkey module. Use the DEV accounts on the local fork.
- **Passkeys on iOS** need a development build, which also needs the passkey domain below:
  ```bash
  FHISH_PASSKEY_DOMAIN=pay.yourdomain.com FHISH_APP_ID=com.you.fhishpay npx expo prebuild --clean
  npx expo run:ios --device       # iOS 18+ (PRF). Pods + DerivedData need several GB of disk.
  ```
- Physical phone on the local fork: `EXPO_PUBLIC_LOCAL_HOST=<your Mac's LAN IP> npx expo start`. The Android emulator uses `10.0.2.2`.
- DEV helper: `node scripts/make-link.ts 5.25` makes DEV alice create a pay link and prints both URLs, so you can open it in Expo web or the simulator.
- DEV helper: `node scripts/make-request.ts 42.50 "rent october"` makes DEV bob request that amount from DEV alice and prints the request link (open it as alice).

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `FHISH_PASSKEY_DOMAIN` | `pay.fhish.example` (placeholder) | WebAuthn RP ID. Also feeds `webcredentials:` / `applinks:` in app.config.ts. |
| `FHISH_APP_ID` | `xyz.fhish.pay` | iOS bundle id and Android package. |
| `EXPO_PUBLIC_LINK_HOST` | `pay.fhish.example` | Host for `https://<host>/claim?…#k=…` pay links and `https://<host>/request?…` request links. Use the same host as the passkey domain. |
| `EXPO_PUBLIC_SESSION_MINUTES` | `5` | How long the signing session lives before the key is wiped and the passkey is asked again. |
| `EXPO_PUBLIC_LOCAL_HOST` / `_LOCAL_RPC` / `_LOCAL_GATEWAY` | `127.0.0.1`, `:18810`, `:8890` | Local fork endpoints. |
| `EXPO_PUBLIC_TESTNET_GATEWAY` | (none) | Fhish gateway for Monad testnet, once deployed. |

## Passkey domain (user action)

Mera passkeys are bound to an HTTPS host (the RP ID). Before passkeys can work on a device:

1. **Choose a host you control**, for example `pay.yourdomain.com`. Use a bare hostname, without `https://` or a path.
2. **iOS**: put your Apple **Team ID** and the bundle id into `well-known/apple-app-site-association`, replacing `TEAM_ID.xyz.fhish.pay`. Serve it at `https://<host>/.well-known/apple-app-site-association` as JSON, publicly, with no redirect. It covers `webcredentials` (passkeys) and `applinks` (`/claim*` and `/request*` links open the app).
3. **Android**: put the package name and the SHA-256 fingerprint of every signing certificate into `well-known/assetlinks.json`. Serve it at `https://<host>/.well-known/assetlinks.json`. Print the debug fingerprint with `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.
4. Build with `FHISH_PASSKEY_DOMAIN=<host> FHISH_APP_ID=<bundle id> EXPO_PUBLIC_LINK_HOST=<host> npx expo prebuild --clean`. app.config.ts adds `webcredentials:<host>` and `applinks:<host>` to Associated Domains, and Android App Links intent filters for `https://<host>/claim` and `https://<host>/request`. Signing requires an Apple developer team in Xcode.
5. Optional: have `https://<host>/claim` serve a small page that sends people without the app to the store. The `#k=` fragment never reaches the server.

On **Expo web**, passkeys use the browser's WebAuthn with RP ID = the page's host. That needs a PRF-capable authenticator such as iCloud Keychain, Google Password Manager or 1Password.

## How the on-device FHE encryption works

Hermes has no WebAssembly, so tfhe runs in a **hidden `react-native-webview`**:

- `scripts/build-tfhe-webview.mjs` (run by `install-deps.sh`) takes Zama's **`node-tfhe` 1.8.1**. That's the single-threaded wasm-bindgen build, the same tfhe-rs version as the Fhish engine. Unlike the browser `tfhe` package, it doesn't need `SharedArrayBuffer` or cross-origin isolation, which a WebView can't guarantee.
- The script inlines the tfhe JS and the 4.7 MB wasm, both gzip+base64, into **one self-contained HTML string**. The result is about 1.9 MB, written to `src/fhe/encryptorHtml.generated.ts` (gitignored).
- The only change to Zama's JS is replacing its trailing synchronous `fs.readFileSync` + `new WebAssembly.Module` with an async `WebAssembly.instantiate`.
- The page needs no network and no file access. The native app loads it with `source={{ html }}`. Expo web loads it as a sandboxed `<iframe srcDoc>`. Node (`scripts/node-encryptor.ts`) runs the identical `<script>` in a `vm` context, which is how `verify-fork.ts` exercises the exact code the phone runs.
- Protocol: the app sends `setKey` once, with the network public key (`GET {gateway}/keys/public`, about 33 KB). It then sends `encrypt {type: 4, value}` and gets back the serialized `CompactCiphertextList` as base64. In Node, one u64 takes about 5 ms; in the browser, about 12–90 ms.
- The plaintext amount goes only into the WebView. The gateway receives only the ciphertext list and returns `{handle, proof}`, bound to (contract, sender).

**Reveal** (`src/lib/seal.ts`) re-implements the SDK's WebCrypto unseal with @noble: P-256 ECDH (x coordinate), then HKDF-SHA256 (empty salt, info `fhish-seal-v1`), then AES-256-GCM. It matches `coprocessor/src/seal.ts` byte for byte, and the ephemeral secret is zeroed after use.

## Pay-link security

- The one-time claim key is generated on the phone and placed **only in the URL fragment** (`#k=`), which is never sent to servers. The UI shows it masked.
- The key is never logged and never sent anywhere except inside the link the user shares. Expo web removes it from the address bar after reading it.
- The link key signs `claimDigest(id, to)` = EIP-191 over (contract, chainid, id, to), so a front-runner or the gas sponsor can't redirect the funds.
- Unclaimed links can be refunded to the sender after expiry (`refundLink`, in `src/lib/pay.ts`; there's no UI button for it yet).

## Payment requests

- `requestPayment(payer, encryptedAmount, proof, expiry, ref)`: the amount is encrypted on the phone **for the payee** (the tx sender). The contract shares the outstanding amount (`requestDue`) with exactly two addresses, payee and payer; both reveal it with the same EIP-712 + sealed-reply flow as a balance.
- `payRequest(id)` can only be sent by the payer, from their own account (it pays its own gas; there is no sponsor because the payer must be `msg.sender`). It is all-or-nothing: it moves what is owed, or, if the encrypted balance is short, nothing, and the request stays open owing the same amount. The chain can't tell which happened, so the app always re-reveals what is owed after paying. The Pay button appears only after the payer has revealed the amount, so nobody pays blind and a settled request isn't paid twice.
- `cancelRequest(id)` is payee-only. Reverts are shown as plain sentences (`RequestNotOpen`, `BadPayer`, `NotPayer`, `NotPayee` in `describeError`).
- **The reference stays private too.** On-chain it is only `keccak256(memo)`, like Send's reference. The readable memo travels in the link's `#m=` fragment, which is never sent to a server. The link's `b=` parameter (the request's block) lets the app read the `PaymentRequested` event with a single `eth_getLogs` and show whether the memo matches what was committed.
- A request link holds **no secret**: only the payer can pay it and only the two parties can read it, so it is safe in any chat.

## Structure

```
App.tsx                      navigation (tabs + stack), deep links, fonts, encryptor host
app.config.ts                scheme fhishpay, associated domains, RP ID (env)
metro.config.js              watches the symlinked node_modules
src/polyfills.ts             crypto.getRandomValues (expo-crypto) for Hermes
src/lib/                     NO React, runs in Node too (scripts/verify-fork.ts)
  config.ts                  networks: local fork / Monad testnet
  deployments.ts             GENERATED by scripts/sync-deployments.mjs
  wallet.ts                  Mera: PRF -> BIP-39 -> BIP-44 -> signing session -> viem account; DEV keys
  fhish.ts                   FhishClient (encrypt via Encryptor, userDecrypt with noble unseal)
  seal.ts                    P-256 / HKDF / AES-GCM unseal
  pay.ts                     faucet, ERC-3009 wrap, pay, links, claim, refund, unwrap, requests, activity, gas x1.3
  monad.ts                   MonadHeads (monadNewHeads), trackByTags, sendRawSync
  links.ts                   build/parse pay links (key in the fragment) and request links (memo in the fragment)
src/fhe/                     encryptor page (generated), bridge, WebView host (+ .web iframe host)
src/state/                   AppState (account, session expiry, network), storage, passkeyEnv (+ .web)
src/ui/                      theme, kit, Ladder, Heartbeat, Screen, hooks
src/screens/                 Onboarding, Home, Fund, Send, Request (create + detail), Claim, CashOut, Activity, Account
scripts/                     install-deps.sh, build-tfhe-webview.mjs, sync-deployments.mjs,
                             verify-fork.ts, make-link.ts, make-request.ts, node-encryptor.ts
well-known/                  AASA + assetlinks templates for the passkey domain
evidence/                    screenshots + verify output (see EVIDENCE.md)
```

## Networks

- **local**: the Monad-testnet fork (chain id 10143). It reads addresses from `contracts/deployments/local.json` and `local-apps.json` (`causd`). Settlement is shown from block tags (latest, safe, finalized). DEV accounts and the DEV sponsor (anvil `carol`) exist only here.
- **testnet**: `https://testnet-rpc.monad.xyz`, with settlement from `monadNewHeads`, up to Verified. Fhish Pay isn't deployed there yet (`DEPLOYMENTS.testnet` is `null`), so the app tells the user to stay on the fork. After deployment, run `npm run sync:deployments` and set `EXPO_PUBLIC_TESTNET_GATEWAY`. On testnet a new passkey account needs testnet MON for gas, because there's no sponsor.
