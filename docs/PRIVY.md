# How Kakushi uses Privy: a bridge Maker's hot key that can only do its job

*Kakushi · Monad Metropolis, Track 04 · live at https://kakushi.vercel.app*

Kakushi is the privacy provider for Monad. ZK hides *who* (stealth addresses, a shielded pool, private calls) and FHE hides *how much* (encrypted balances and payments). Its cross-chain leg is a **Maker bridge**: you pay a Maker on one chain, and the Maker pays you on the other, optionally to a one-time stealth address. Makers post margin on Monad, and if a Maker doesn't pay, a ZK proof slashes that margin.

Privy does two jobs in Kakushi:

| Role | Privy feature | Job |
|---|---|---|
| User login | Embedded and external wallets | Email, Google or any wallet on the app's Connect button |
| **Maker hot key** | **Server wallets + the policy engine** | **The key that fills bridge transfers, fenced so it can do nothing else** |

This article is about the second job.

## The problem: a hot key that holds the money

A Maker node must sign by itself: it watches source chains and pays out within seconds, with no human in the loop. Normally that means a raw private key on a server. That key controls the Maker's whole inventory and can sign anything. If someone takes the host, they take the funds.

What a Maker key actually needs to do is small and fixed:
- pay out (`fill`) or refund (`refund`) through Kakushi's **PayoutRouter**;
- answer a dispute on the Monad hub (`DisputeModule.answerDispute`);
- approve USDC to the PayoutRouter or the margin contract (MDC), and top up margin.

Everything else, such as sending USDC to an arbitrary address or calling another contract, should be impossible for the hot key.

## How it works

### 1. The policy is built from the deployment

`packages/maker/scripts/privy-setup.ts` reads `config/generated/deployments.<network>.json` and builds a **default-deny** Privy policy. Every rule names the exact contract, chain, function and limits:

```ts
const groups = [
  { name: "router fill/refund", conditions: [tx("to", "in", routers), tx("chain_id", "in", chainIds), tx("value", "lte", maxNative), call(ROUTER_ABI, "function_name", "in", ["fill", "refund"])] },
  { name: "answerDispute", conditions: [tx("to", "in", both(hub.disputeModule)), tx("chain_id", "eq", MONAD), call(DM_ABI, "function_name", "eq", "answerDispute")] },
  { name: "USDC approve router/MDC", conditions: [tx("to", "in", usdcs), tx("chain_id", "in", chainIds), call(APPROVE_ABI, "approve.spender", "in", [...routers, ...both(hub.mdc)])] },
  { name: "MDC depositMargin", conditions: [tx("to", "in", both(hub.mdc)), tx("chain_id", "eq", MONAD), call(MDC_ABI, "function_name", "eq", "depositMargin")] },
  { name: "EBC setActive", conditions: [tx("to", "in", both(hub.ebc)), tx("chain_id", "eq", MONAD), call(EBC_ABI, "function_name", "eq", "setActive")] },
];
```

Each group becomes an ALLOW rule for both `eth_signTransaction` and `eth_sendTransaction`. Anything not listed is refused by Privy before a signature exists. The script creates the policy and a server wallet bound to it (`privy.wallets().create({ chain_type: "ethereum", policy_ids: [id] })`). When a new chain deploys, `--update-policy <id>` rewrites the rules in place and keeps the wallet. We did this live when Sepolia came online: the policy now covers chains 10143 and 11155111.

### 2. The Maker signs through Privy, never with a local key

`packages/maker/src/signer.ts` turns the server wallet into a viem `Account`. `signTransaction` posts the transaction to Privy's wallet RPC (`eth_signTransaction`), authenticated with the app secret and, optionally, an authorization key (a P-256 signature over the canonical request). The Maker engine doesn't know which signer it has: `MAKER_KEY` gives a local key, and the `PRIVY_*` variables give the server wallet.

## Engineering notes

- **Rule names have a 50-character limit.** We prefix them `sign:` / `send:` and keep the group names short.
- **Addresses are matched in both cases.** Calldata comparisons are string matches, so every address goes in as lower case and checksummed.
- **Zero-fee signatures, a bug we found live.** The signer always asked Privy for an EIP-1559 transaction built from `maxFeePerGas`/`maxPriorityFeePerGas`. A caller passing a legacy `gasPrice` got back a zero-fee signature, which Monad rejects ("fee too low"). We found it in the live proof below. Now a `gasPrice` fills both caps, and passing neither is an error.
- **Monad bills the gas limit.** Every Privy-signed transaction carries `estimate × 1.15`, not a padded constant.

## The value it brought

The bridge's security model already protects users: a Maker that doesn't pay loses its margin. Privy protects the **Maker**. A Maker can run a hot node on an ordinary host without its inventory being one stolen key away from gone. A compromised host can, at worst, pay out bridge transfers correctly. That turns "run a Maker" from a custody decision into an ops decision, which is what lets more Makers join, and more Makers means better prices and more routes.

## Live proof (Monad testnet, 10143)

`scripts/privy-proof-testnet.ts`, run on 13 Oct 2026, against the policy-fenced server wallet `0x8d1D30fBeef675E108ca2538E85f915CDB134f63`:

- **Allowed:** Privy signed `USDC.approve(PayoutRouter)`, and it landed: [0x99a69528…27b4](https://testnet.monadvision.com/tx/0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4).
- **Refused:** `USDC.transfer` to an outside address got `400 RPC request denied due to policy violation`. A refusal never reaches the chain, so its evidence is the script output: [docs/evidence/testnet-privy.json](evidence/testnet-privy.json).
- Earlier, on 12 Oct, the same policy signed `PayoutRouter.fill` on chain 10143 and refused the identical `fill` on chain 1.

**Honest scope.** The live Maker 1 still runs a local key. Moving it to the Privy wallet needs that wallet to post margin and register routes on chain, which we didn't spend testnet MON on before the deadline. The policy and the signer are proven on chain separately, as above. The app's login is Privy too (email, Google or any wallet).

Code: [`packages/maker/scripts/privy-setup.ts`](../packages/maker/scripts/privy-setup.ts), [`packages/maker/src/signer.ts`](../packages/maker/src/signer.ts), [`scripts/privy-proof-testnet.ts`](../scripts/privy-proof-testnet.ts).
