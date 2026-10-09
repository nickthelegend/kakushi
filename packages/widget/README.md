# @kakushi/widget

Make your checkout private in one line. `<KakushiPay />` is a drop-in pay button: one click pays a
fresh one-time [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) stealth address through
Kakushi's `StealthPay` contract. Nobody watching the chain can tell who got paid.

It is plain React with viem. It doesn't need Next.js, Tailwind or a stylesheet import.

## Quick start

```tsx
import { KakushiPay } from "@kakushi/widget";

<KakushiPay to="0xMerchant…" amount="25" token={USDC} chain={monadTestnet} walletClient={wallet} publicClient={client} deployment={privacy} onPaid={({ txHash, stealthAddress }) => fulfil(txHash)} />
```

`deployment` is the chain's privacy entry (`{ stealthRegistry, stealthPay }`). A `privacy` object
from `@kakushi/config/deployments` works as is.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `to` | `string` | required | Recipient. A stealth meta-address (`st:eth:0x…`), or a plain address that is registered on the ERC-6538 registry. If the address hasn't enabled private receiving, the button is disabled and says so. |
| `amount` | `bigint \| string` | required | A bigint in base units, or a decimal string (`"12.5"`) scaled by `decimals`. |
| `token` | `"native" \| Address` | `"native"` | `"native"` pays the chain's coin. Pass an ERC-20 address to pay a token: the widget checks the allowance and asks the wallet to approve `StealthPay` for exactly `amount` first when needed. |
| `chain` | viem `Chain` | wallet's chain | The chain to pay on. The wallet is asked to switch to it if it's on another one. Its block explorer is used for the "View transaction" link. |
| `walletClient` | `WalletClient \| () => Promise<WalletClient> \| null` | required | The payer. A function works for wallets that connect lazily (Privy, wagmi `getWalletClient`). While it's `null`, the button shows "Connect a wallet to pay." |
| `publicClient` | `PublicClient` | required | Used for the registry lookup, allowance and receipts. |
| `deployment` | `{ stealthPay; stealthRegistry? }` | required | Privacy-layer addresses for `chain`. |
| `onPaid` | `(r: KakushiPaymentResult) => void` | | Called with `{ txHash, stealthAddress, ephemeralPublicKey, viewTag, metaAddress, amount, token, chainId, approveTxHash?, receipt }`. |
| `onError` | `(e: KakushiPayError) => void` | | `e.code` is one of `INVALID_RECIPIENT`, `RECIPIENT_NOT_REGISTERED`, `NO_REGISTRY`, `INVALID_AMOUNT`, `INVALID_TOKEN`, `NO_ACCOUNT`, `WRONG_CHAIN`, `USER_REJECTED`, `TX_REVERTED` or `UNKNOWN`. `e.message` is written for end users. |
| `onStatus` | `(e: { status, step?, txHash? }) => void` | | Reports every state change. |
| `label` | `ReactNode` | `"Pay privately"` | Button text while idle. |
| `theme` | `KakushiTheme` | Kakushi navy/royal blue | See [Theming](#theming). |
| `decimals` | `number` | native decimals / token `decimals()` | Only used when `amount` is a string. |
| `stealthGas` | `bigint` | `0n` | Wei sent along with an ERC-20 payment, so the stealth address has gas to move the tokens later. |
| `account` | `Account \| Address` | wallet's account | Overrides the payer account. |
| `confirmations` | `number` | `1` | How many confirmations to wait for. |
| `preflight` | `boolean` | `true` | Looks up the recipient as soon as `to` changes, so an unregistered recipient shows up before the click. |
| `showStatus` | `boolean` | `true` | Shows the status line. Screen readers get it either way. |
| `disabled`, `className`, `style` | | | Applied to the wrapper and button as you'd expect. |

The states are `idle`, `resolving`, `confirming`, `sending`, `paid` and `error`. `confirming` and
`sending` carry a `step`, which is `"approve"` or `"pay"`. The wrapper exposes the current state as
`data-status`.

Accessibility: it's a real `<button type="button">`. It sets `aria-busy` while working and points
`aria-describedby` at a polite `role="status"` region. Failures go into a `role="alert"`. Focus
gets a visible ring, and the spinner slows down under `prefers-reduced-motion`.

## Custom UI: `useKakushiPay`

```tsx
const k = useKakushiPay({ to, amount, token, chain, walletClient, publicClient, deployment, onPaid });
<button disabled={!k.canPay} onClick={() => k.pay()}>{k.status === "paid" ? "Done" : "Pay"}</button>
{k.recipient.state === "error" && <p>{k.recipient.error.message}</p>}
```

The hook returns `{ status, step, pendingTxHash, error, result, recipient, busy, canPay, pay, reset }`.

## No React: `createKakushiPayment`

```ts
import { createKakushiPayment } from "@kakushi/widget/core";

const { txHash, stealthAddress } = await createKakushiPayment({ to, amount: 10n ** 18n, token: "native", chain, walletClient, publicClient, deployment, onStatus: console.log });
```

`resolveRecipient(to, publicClient, deployment)` is exported on its own, so you can check a
recipient before you render anything.

## Theming

Every color and size is a CSS variable with a Kakushi default. Set them per instance with `theme`:

```tsx
<KakushiPay theme={{ accent: "#0a7d55", radius: "10px", width: "100%" }} … />
```

You can also set them from your own CSS on any ancestor:

```css
.checkout { --kakushi-accent: #0a7d55; --kakushi-radius: 10px; }
```

| `theme` key | CSS variable | Default |
| --- | --- | --- |
| `background` | `--kakushi-bg` | `#0b0f1f` (focus-ring gap) |
| `accent` | `--kakushi-accent` | `#2f47f5` |
| `accentHover` | `--kakushi-accent-hover` | `#4a5ff7` |
| `text` | `--kakushi-text` | `#fff` |
| `muted` | `--kakushi-muted` | `#8d97c2` |
| `error` | `--kakushi-error` | `#ff8a8a` |
| `success` | `--kakushi-success` | `#7ee2b8` |
| `radius` | `--kakushi-radius` | `999px` (pill) |
| `fontFamily` | `--kakushi-font` | system UI stack |
| `fontSize` | `--kakushi-font-size` | `15px` |
| `height` | `--kakushi-height` | `44px` |
| `width` | `--kakushi-width` | `auto` |

The styles are one small scoped stylesheet (`.kakushi-pay*` classes) that ships with the
component. React 19 renders it once per document.

## How recipients get paid

A recipient turns on private receiving once in the Kakushi app's **Receive** page
([kakushi.vercel.app/receive](https://kakushi.vercel.app/receive)). They sign a message to derive
their stealth keys, then register their meta-address on the ERC-6538 registry. After that, any
`<KakushiPay to="0xTheirWallet" />` resolves to them. You can also hand out the `st:eth:0x…`
meta-address directly, with no registry lookup.

Every payment goes to a new address that only the recipient can link to them. `StealthPay`
announces it on the ERC-5564 announcer. The Receive page scans those announcements with the
recipient's viewing key, shows each payment's balance, and moves the funds to any wallet they choose.

## Development

```sh
pnpm --filter @kakushi/widget typecheck
pnpm --filter @kakushi/widget test   # vitest, --maxWorkers=1
```

The package ships TypeScript source. Next.js apps need it in `transpilePackages`.
