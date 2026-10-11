# mm-kakushi: confidential trading for the MetaMask Agent Wallet

A plugin for the MetaMask Agent Wallet CLI (`mm`) that gives agents a new trading superpower on Monad:
**trade without revealing your numbers.** Limit prices, bids and stablecoin amounts are encrypted on
your machine with fully homomorphic encryption (Zama tfhe-rs via `node-tfhe`) and computed on, still
encrypted, by [Kakushi](../../README.md) contracts on Monad.

| Command | Capability | What it does |
|---|---|---|
| `mm kakushi status` | wallet-read | Network, gateway, FHE engine and app addresses |
| `mm kakushi otc orders` | none | Dark OTC book: pair, size, open; prices are ciphertext |
| `mm kakushi otc post <pair> <size> <min>` | wallet-submit | Post an order with an encrypted minimum price |
| `mm kakushi otc take <order> <max>` | wallet-submit | Take with an encrypted maximum. A miss reveals nothing; a cross reveals only the maker's price |
| `mm kakushi auction bid <amount>` | wallet-submit | Sealed bid; only the winning bid is ever revealed |
| `mm kakushi cusdc send <to> <amount>` | wallet-submit | Confidential USDC transfer (amount and balances stay encrypted) |
| `mm kakushi cusdc balance` | wallet-submit (EIP-712) | Reveal your own balance to you alone, sealed to this process |

Every transaction and EIP-712 signature goes through `ctx.walletExecutor`, so Guard Mode, Blockaid
and 2FA apply as for built-in commands. Each transaction carries an explicit gas limit of
estimate + 30%, because Monad bills the gas limit. Values are encrypted locally; only ciphertext and
a k-of-n input attestation leave the machine.

## Why an agent wants this

An agent that trades in public leaks its strategy: its limit prices and sizes are front-run and
copied. With `mm kakushi`, the agent's reservation prices stay encrypted. The chain learns whether two
encrypted prices crossed, and at what price, and nothing else.

## Install (dev)

```bash
pnpm --filter mm-kakushi build                       # bundles commands, embeds deployments
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD"                     # review and accept the capabilities
mm login                                           # your MetaMask account
mm kakushi status
```

Configuration: `KAKUSHI_FHE_NETWORK` (`testnet` by default, `local` for the fork), `KAKUSHI_FHE_GATEWAY_URL`,
`KAKUSHI_FHE_RPC_URL`, `KAKUSHI_FHE_DEPLOYMENT`, `KAKUSHI_FHE_APPS`.

## Verified

- `tsc` against the real `@metamask/agent-wallet` 7.1.0 plugin types; `oclif manifest` lists the 7 commands.
- Installed into the real `mm` 7.1.0 host (`mm plugins install`); `mm kakushi --help` lists the
  commands; running one reaches the host's auth gate (`mm login` needed).
- `pnpm --filter mm-kakushi test`: the plugin core on the local Monad fork. Dark OTC miss and cross,
  private cUSDC send with an owner-only reveal, sealed bid, status. These use real tfhe-rs ciphertexts
  and real oracle callbacks; a local key stands in for the MetaMask executor.
- Not yet run: the commands through a signed-in `mm` wallet on Monad testnet (needs `mm login` and
  the testnet deployment).
