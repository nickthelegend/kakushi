# Deployment hold and release gates

On 2026-10-09 the user explicitly requested building and shipping everything end to end. This supersedes the earlier general deployment hold for this release work. A successful local run still does not establish sponsor verification or provide missing credentials/funding. Kakushi currently has no configured testnet deployer; the deployment wallet/environment path has been requested without asking for private keys in chat.

Before a future release, record passing contract/circuit/package tests and a final-source app build; preserve all four real local demo outcomes with chain IDs, contract addresses, transaction hashes and proof timings. Audit source/destination chain configuration, decimals, allowance bounds, immutable compliance configuration, dispute timing and verifier keys. Confirm the built verifier corresponds to the reviewed circuit artifacts.

Resolve [sponsor gaps](SPONSOR-GAP.md), configure real authenticated Privy and CRE environments, confirm the canonical Cleanverse ABI and pool onboarding, and verify the indexer against actual logs. Inspect configuration for development keys and local-only RPC assumptions without publishing secret values. Use the configured testnet deployer only after checking its chain IDs, balances, intended operations and bounded costs; do not infer mainnet release authorization.

The app's production default is testnet. Vercel deployments reject an explicit local mode. The standalone Docker build is `docker build -f packages/app/Dockerfile .`; its context excludes local deployment records, development service configs, state and environment files. Mount actual `deployments.testnet.json` and `makers.testnet.json` into `/app/config/generated` after deployment. An absent deployment remains unavailable rather than being replaced with local addresses. Configure actual remote service URLs and optional `KAKUSHI_ENVIO_GRAPHQL_URL`; the Maker market reads bounded Envio MakerStats/RouteStats with unknown values on failure, while transfer history retains the RPC fallback. A live GraphQL run is still needed to verify the hosted schema/access policy.

No mainnet safety or external sponsor verification claim follows from local demo success. The four-scenario local run and browser proof/submission passed; evidence is in [VERIFICATION](VERIFICATION.md).

## Monad testnet deployment (2026-10-12)

Deployed by `node scripts/deploy-testnet.ts --broadcast --chains monadTestnet --skip-makers --max-mon 10` from the Kakushi deployer `0x2c76aA36C88E89734223A5Cf0c54697782B9C24C` on Monad testnet (10143) only. 43 transactions, no MON value sent. Gas cost: 6.645 MON (12 → 5.355 MON left). The dry-run estimate was 7.19 MON at live `eth_gasPrice` × 1.1 = 112.2 gwei; Monad bills the gas limit, and limits were estimate × 1.15. Every contract below is verified on Sourcify (MonadVision): `node scripts/verify-testnet.ts`. The UltraHonk verifiers and their libraries are a bytecode `match`; everything else is an `exact_match`.

**CRE forwarder.** The AttestationOracle and the FHE decryption oracle store Chainlink's **MockKeystoneForwarder** `0xB9F79d863261869B234c481D1f9A7af84AeAd192` as an immutable. This is the forwarder that `cre workflow simulate --broadcast` writes through, and the documented path while Kakushi has no deployed DON workflow. The production KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` would need a deployed workflow and `cre account access` approval, so the oracles would have to be redeployed to switch to it. The mock forwarder does not check DON signatures. Reports are still bound to the workflow owner `0x4d9e1a826a6DBE986EF8997E57464A2a3443DAb2`, and FHE results also need k-of-n KMS signatures.

| Contract | Address |
|---|---|
| DisputeModule | `0xE701a71Ec80Db1e50fbA55fC902CBc8919dD3aF9` |
| EBC | `0x4AeceD018b464d4870872935CdF47039D3A53ECf` |
| MDC | `0xe12c7c7da94fE211AaAD848fd2919714C96988A2` |
| AttestationOracle | `0xc50A536E04DA4E2385e66fCf211820438F4905Da` |
| PaymentComplianceVerifier | `0x042937E61F63c14f7B4cc173D41DF0D3bE0cF9D0` |
| PayoutInclusionVerifier | `0x4A20a97DBE4346F4BA5fa0ee06902D63714A40d8` |
| PayoutRouter (same address on every chain) | `0x8187a35540972150A02c884048bF2F6B6aa7D1C1` |
| SourceRouter (same address on every chain) | `0xB1d06c6E0464dE3C28DB5bb1bb9313F2037C8707` |
| StealthRegistry (ERC-6538) | `0x8777bf242EEe2112BA9185FB6571604dFD543A62` |
| StealthAnnouncer (ERC-5564) | `0x7030628079Ce422c905DD819ba6ad95B562d66Aa` |
| StealthPay | `0x0f650e5bC29242eBc107CA7B879d33c4EE4f4B04` |
| ShieldedWithdrawVerifier | `0xa5869C109b398e7A8663891BB1D6e0108F913015` |
| KakushiPoolFactory | `0x2DfB49d4BDE2adF332407fe47dF835477a1Ecb3f` |
| KakushiPool MON-0.1 (factory) | `0x5f859405D69F24385C0Cf2297a6b2D4c91be2950` |
| KakushiPool USDC-1 (factory, Circle USDC) | `0xD1f5598c3A5e6250D2f6448bD5e2D9e3d3954E2B` |
| FHE KakushiRegistry (CREATE3) | `0x0047D047510cd9201470c7Eb85cE0FdF69d7De90` |
| FHE KakushiExecutor | `0x632871F641F89ef095eE721c49B1F75b95471010` |
| FHE KakushiACL | `0x8bF5C374132Ebe1903a2D649B38CA8498Bd19eDD` |
| FHE KakushiInputVerifier (2-of-3) | `0x48447Aa38500d09cfAfd7512fc25d8D0cfd73764` |
| FHE KakushiDecryptionOracle (2-of-3 KMS) | `0x572B783e22659fA8E3A10e09b93f09c92CcC4a7d` |
| cUSDC (KakushiPayToken over Circle USDC) | `0x18567b9fa61E7322f8d4111c7606107C7eEb55a1` |
| cAUSD (KakushiPayToken over Agora AUSD) | `0x215032585515b2d55aB53Cb1b088deC0f75E4c77` |
| ConfidentialStealthPay | `0x0b1fffD49Ccd2BcBDe14359C9435185A1607F7C6` |

Records: `packages/contracts/deployments/testnet/10143.json`, `fhe/contracts/deployments/testnet.json` (+ `testnet-apps.json`), and the app's `config/generated/{deployments,fhe,makers,relayer,operators}.testnet.json`. These files hold public addresses only and are committed, because Vercel reads them at runtime. `makers.testnet.json` is `[]` until Makers register. The app shows Kakushi Confidential as not live until the FHE gateway is hosted and `KAKUSHI_FHE_GATEWAY_URL` is set (`fhe.testnet.json` has `gateway: null`).

**Not done yet (not funded):** the Sepolia and Base Sepolia spokes, the Makers (routes, margin), and the relayer and watchtower. `deployments.testnet.json` therefore covers the hub only, and the CRE configs (`packages/cre/scripts/configure.ts testnet`) need a spoke first.

### Resuming

`node scripts/deploy-testnet.ts --dry-run` simulates the rest on throwaway forks and prints per-chain costs against the live balances. `node scripts/deploy-testnet.ts --broadcast` then sends only what is missing, because every step checks the chain first. Keys come from `.env.testnet`. Funding still needed: Sepolia/Base deployer about 0.0001 ETH each (gas was 0.001-0.007 gwei on 2026-10-12; budget 0.05 for spikes). Maker 1 needs about 0.14 MON, 1.5 USDC margin on Monad and a little Sepolia ETH. Maker 2's ETH lane (max 0.002 ETH) needs about 7 USDC of Monad margin at ETH $2,515: with 3 USDC it is skipped, or pass `--maker2-max-eth 0.0008`. Maker 2 also has no planned Sepolia/Base ETH to fill with.

Monad reserve rule: the deploy sends no MON value. The watchtower's 0.05 MON bonds are serialized and spaced at least 3 blocks / 1.2 s apart (`packages/watchtower/src/spacing.ts`), so each one can use the emptying exception.
