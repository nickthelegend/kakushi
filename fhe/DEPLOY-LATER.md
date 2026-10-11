# Deploy later (held until the owner funds and says go)

Nothing in this file has been run. Kakushi Confidential (FHE) is proven on a **local fork** of Monad testnet only; no
Monad testnet transaction has been sent. Each step names who must do it.

## 0. Owner actions first

| # | Action | Why |
|---|---|---|
| 1 | Fund the deployer `0x844bBB648B6e3214452c774D3495dC1bD1295a86` with ~3 MON on Monad testnet | Registry (CREATE3) + executor, ACL, input verifier, oracle, demo apps |
| 2 | Fund the relayer `0x74056a101AaD54F43d6721705c1BAA87993CbF16` with ~2 MON | Direct `fulfill` path (fallback to CRE) |
| 3 | `cre login` (browser) | `cre workflow simulate --broadcast` for the Chainlink bounty |
| 4 | Say "go" | Coordinator rule: no testnet transactions before that |

Keys live in `.secrets/` (gitignored, mode 600): `deployer.json`, `signers.json` (3 input signers,
3 KMS signers, relayer).

## 1. Contracts on Monad testnet (10143)

Pick the CRE forwarder. The oracle stores it as an immutable, so this choice is final per deployment:

- `0xB9F79d863261869B234c481D1f9A7af84AeAd192`: **MockKeystoneForwarder** (simulation). `cre workflow
  simulate --broadcast` writes through it. Recommended for the hackathon: the bounty accepts CLI
  simulation, and the oracle's KMS-signature check makes an open forwarder safe (it can only deliver
  results the KMS signed).
- `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`: production KeystoneForwarder, which needs a deployed
  workflow and `cre account access` approval.

```bash
cd contracts
DEPLOYER=0x844bBB648B6e3214452c774D3495dC1bD1295a86 \
INPUT_SIGNERS=$(jq -r '[.inputSigners[].address]|join(",")' ../.secrets/signers.json) \
KMS_SIGNERS=$(jq -r '[.kmsSigners[].address]|join(",")' ../.secrets/signers.json) \
INPUT_THRESHOLD=2 KMS_THRESHOLD=2 \
CRE_FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 \
REGISTRY_SALT=$(jq -r .salt registry-address.json) KAKUSHI_FHE_NETWORK=testnet \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast \
  --private-key $(jq -r ".[0].private_key" ../.secrets/deployer.json) --slow
```

Check: `deployments/testnet.json` has `registry == 0xEc4A6767F7884712C0B19ada05F9C98e5fd341E7`.
Verify on MonadVision/Sourcify (`forge verify-contract --verifier sourcify --chain 10143 …`).
Then deploy the apps with the same calls `scripts/e2e-local.ts --keep` makes, and write
`deployments/testnet-apps.json`:
- **Kakushi Pay**: `KakushiPayToken(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC /* AUSD */, "Confidential AUSD", "cAUSD")`
  as `causd`, and optionally one over Circle USDC `0x534b…43A3`.
- Playground extras: auction, cUSDC wrapper, dark OTC.
Demo funds: Agora's faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` `requestFunds(address)` gives 10,000
AUSD (60 s global cooldown); Circle's faucet gives testnet USDC.

## 2. Engine, coprocessor, gateway

```bash
engine/bin/kakushi-fhe-engine serve --dir .kakushi-fhe --port 8899           # same keys as local: .kakushi-fhe/keys
KAKUSHI_FHE_NETWORK=testnet RPC_URL=https://testnet-rpc.monad.xyz DELIVER=both \
  node coprocessor/src/main.ts                                   # gateway :8890
```

Hosting (Railway or a VM): the engine needs ~1 GB RAM (server key ~180 MB) and several cores; keep
`.kakushi-fhe/keys/client_key.bin` off any shared disk. Expose only the gateway (HTTPS); the engine stays
private. Monad specifics already handled: `eth_getLogs` ≤ 100 blocks, explicit tight gas limits.

## 3. Chainlink CRE

```bash
cd cre
KAKUSHI_FHE_NETWORK=testnet KAKUSHI_FHE_GATEWAY_URL=http://127.0.0.1:8890 node scripts/configure.ts
cre workflow simulate ./workflows/decrypt-relay --non-interactive --trigger-index 1 --broadcast -T staging-settings
```

`simulate` runs the WASM on this machine, so a localhost gateway works. A real deployment
(`cre workflow deploy`) needs a public gateway URL and the production forwarder.

## 4. App

`app/` reads `contracts/deployments/<network>.json` and `<network>-apps.json`. Set
`KAKUSHI_FHE_NETWORK=testnet`, `KAKUSHI_FHE_GATEWAY_URL=https://<gateway>`, `RPC_URL`. The local "Alice/Bob/
Carol" accounts are disabled off the fork; users connect a browser wallet. The COOP/COEP headers in
`next.config.ts` are required for multi-threaded WASM encryption.

## 5. Sponsor setup (owner)

| Sponsor | Owner action | Then |
|---|---|---|
| Privy | Create a Privy app; enable Monad Testnet and gas sponsorship; copy app ID + secret | `app/PRIVY.md`: set env, run `app/scripts/privy-setup.ts` (server wallet + payroll policy) |
| Mera / Agora | A public HTTPS domain for passkeys (AASA `webcredentials`), Apple team ID + bundle ID | `mobile/README.md`: set RP ID / associated domain, build to a device |
| Envio | Envio account (Cloud) or a host for self-hosting | `indexer/README.md`: configure for testnet, deploy |

## 6. Public repository

Push to a public GitHub repo (e.g. `nickthelegend/kakushi`, MIT) after a secret scan of the full
history (`gitleaks detect` or `git log -p | grep -iE "private|secret|0x[0-9a-f]{64}"`). The only
64-hex strings tracked are Foundry's public anvil dev keys used on the local fork.
