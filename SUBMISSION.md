# Kakushi: submission

| | |
| --- | --- |
| Project | Kakushi, the privacy provider for Monad (ZK hides who, FHE hides how much) |
| Live app | https://kakushi.vercel.app (Monad testnet 10143 + Ethereum Sepolia) |
| Repository | https://github.com/nickthelegend/kakushi |
| Sponsors | Working: Chainlink CRE, Privy, BlockVision/MonadVision, Circle USDC, Monad-native RPC. Partial: Agora AUSD, Chainlink Data Feeds, Envio, Cleanverse. See [SPONSOR-COVERAGE](docs/SPONSOR-COVERAGE.md). |
| Backends | Railway: relayer, Maker 1, attester, watchtower, indexer, FHE engine, FHE gateway + KMS |

## The pitch

Every Monad transfer is public: who paid whom, and how much. Kakushi is a plugin that makes any of it private, without the app rewriting itself:

- **Stealth addresses.** Pay a registered wallet; the money lands at a one-time address only the recipient can find and spend.
- **Shielded pool.** Deposit any token, then withdraw it to a fresh address with a zero-knowledge proof. A relayer pays the gas, or the withdrawal calls any contract privately.
- **Encrypted amounts (FHE).** Balances and payments are ciphertexts. Only the owner can decrypt them, sealed to their own browser tab.
- **Both at once.** An encrypted amount goes to a one-time stealth address, so neither who nor how much is public.
- **Cross-chain.** A Maker bridge between Monad and Sepolia, backed by Maker margin on Monad. A Maker that doesn't pay is slashed with a ZK proof checked against Chainlink CRE attestation windows. Deliveries can go to a stealth address.

For developers, there is the `@kakushi/sdk` / `@kakushi/fhe-sdk`, the `<KakushiPay>` React widget, and `contract MyApp is KakushiConfig` for confidential contracts.

## Live evidence (public testnets)

| Flow | Transactions | Result |
| --- | --- | --- |
| Stealth send | `0x7181caa525a2f22f73cba6d07f5a402a6ecd20794077cb98d7584de9033b8505` | Sync receipt in 431 ms. Proposed 431 / Voted 725 / Finalized 1020 / Verified 1933 ms. txpool "tracked". Scanner found it. |
| Shield + ZK withdraw | deposit `0x94531ecb05ab522f0cbdd1d6d0411188fd29e3e46bad0adb863406ef2245a32a`, withdraw `0x5ad430ff2f7eea02551543cca518374ba13212d4297c7f4689e611d3c8b633ca` | A fresh address received 0.1 MON (UltraHonk, 6.22M gas) |
| Gasless withdraw (Sepolia) | deposit `0xc928a1c6…ddc7d`, relayed `0x02882fb832078ba1a41294dcfbf9bd836c84886d2ef0f081c0dc3e1c10acc38c` | A never-funded address received 0.0009 ETH. Sent by the relayer through `kakushi.vercel.app/api/svc/relayer`. |
| Bridge Monad → Sepolia | source `0x2db2e05065aed1369fea3934d17a90a282e015c6c9d78c7f47756fd75a337a1d`, payout `0x11b85b3e1300b81d7c687fce3def9a794c93437edff8d8b4ebadcf14279ce48b` | 0.44955 USDC paid 27.4 s after the source receipt |
| Bridge Sepolia → Monad | source `0x65e30e33951b0caa432d1ce17a897b9a13e26ee4c6263a1ab5d95f6bb234e666`, payout `0x7bd857000ba31adc5b0f68ac9d95e14381d722bdbe3fc5a699bd68765c0670c1` | 0.27972 USDC paid in 11.3 s |
| Confidential (FHE), 8/8 | see [testnet-fhe.json](docs/evidence/testnet-fhe.json) | Wrap, encrypted stealth pay, scan, stealth-key decrypt, move, encrypted pay, KMS cash-out (request #1), pay link |
| Chainlink CRE attestation | `0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8` | 10,000 Monad blocks attested in one report (hosted attester) |
| Privy policy wallet | `0x99a69528658c259ee7d47ffc41101cd135bc6100a2ba3f5719029283cea627b4` | Allowed approve signed by Privy. A transfer out was refused for a policy violation. |
| Contract verification | MonadVision (Sourcify) | Monad 29/29, Sepolia 15/15 |

The raw outputs are in `docs/evidence/testnet-*.json`. Rerun them with the `scripts/*-testnet.ts` files named in the [README](README.md#what-works-live).

## 3-minute demo script

1. **0:00, the problem (landing).** "On Monad, every payment shows who and how much. Kakushi makes both private, for any app." The header pill shows live Monad finality from `monadNewHeads`.
2. **0:20, Receive.** Connect with Privy (email). Turn on private receiving: one signature derives stealth keys and registers the meta-address.
3. **0:45, Send.** Pay that wallet 0.01 MON. It lands at a one-time address. Back on Receive, the inbox finds it.
4. **1:10, Shield.** Deposit 0.001 ETH on Sepolia, copy the note, and withdraw it to a fresh address "via relayer": the proof is made in the browser and the relayer pays the gas.
5. **1:45, Confidential.** Wrap 1 USDC into cUSDC, reveal the encrypted balance (sealed decryption), and pay an encrypted amount to a stealth address. The recipient's inbox shows "Encrypted · Reveal".
6. **2:20, Bridge.** 0.5 USDC from Monad to Sepolia: a live Maker quote, then delivery in about 25 s. "Deliver privately" sends it to a stealth address instead.
7. **2:45, Plugin.** The developers page with the live `<KakushiPay>` widget and the three-line SDK call. "Any app gets this with one component."

## Limits (stated plainly)

- **CRE:** the attester runs the CRE workflow logic through Chainlink's `MockKeystoneForwarder`, the `cre workflow simulate --broadcast` path. It is not a deployed DON workflow.
- **Gasless on Monad:** an UltraHonk withdraw is ~6.2M gas (about 0.9 MON at today's testnet price), more than the 0.1 MON note. The app says so and offers self-withdraw. On Sepolia, gasless works.
- **Chains awaiting funding:** Base, Arbitrum and OP Sepolia spokes are built and fork-tested but await testnet funding. maker2's ETH lane (Chainlink ETH/USD-priced margin) is unfunded.
- **Envio:** offline-tested, not on Envio Cloud. The live indexer is Kakushi's RPC indexer.
- **Cleanverse:** gated on sponsor onboarding.
- **AUSD:** no live testnet AUSD transaction; cAUSD is deployed, and the AUSD flows are fork-tested.
