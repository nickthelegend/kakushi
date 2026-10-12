# Deploy later (held until the owner funds and says go)

**Section 1 (contracts) ran on Monad testnet on 2026-10-12** from the Kakushi deployer through the root
`scripts/deploy-testnet.ts`; all contracts are verified on Sourcify. Registry `0x0047D047510cd9201470c7Eb85cE0FdF69d7De90`,
executor `0x632871F641F89ef095eE721c49B1F75b95471010`, ACL `0x8bF5C374132Ebe1903a2D649B38CA8498Bd19eDD`, input verifier
`0x48447Aa38500d09cfAfd7512fc25d8D0cfd73764` (2-of-3), decryption oracle `0x572B783e22659fA8E3A10e09b93f09c92CcC4a7d`
(2-of-3 KMS, CRE forwarder = Chainlink's MockKeystoneForwarder, the `cre workflow simulate --broadcast` path), cUSDC
`0x18567b9fa61E7322f8d4111c7606107C7eEb55a1`, cAUSD `0x215032585515b2d55aB53Cb1b088deC0f75E4c77`, ConfidentialStealthPay
`0x0b1fffD49Ccd2BcBDe14359C9435185A1607F7C6` (records: `contracts/deployments/testnet.json`, `testnet-apps.json`, root
`config/generated/fhe.testnet.json`). Sections 2-5 (engine/gateway hosting, CRE, app, sponsors) are still to do; the
FHE relayer in `.secrets/signers.testnet.json` is unfunded. Each step names who must do it.

## 0. Owner actions first

| # | Action | Why |
|---|---|---|
| 1 | Fund the Kakushi deployer `0x2c76aA36C88E89734223A5Cf0c54697782B9C24C` on Monad testnet (the root `scripts/deploy-testnet.ts --dry-run` prints the cost) | Registry (CREATE3) + executor, ACL, input verifier, oracle, Kakushi Confidential apps |
| 2 | Fund the FHE relayer in `.secrets/signers.testnet.json` (`relayer.address`) with ~1 MON, or run the coprocessor with `DELIVER=cre` | Direct `fulfill` path (fallback to CRE) |
| 3 | `cre login` (browser) | `cre workflow simulate --broadcast` for the Chainlink bounty |
| 4 | Say "go" | Coordinator rule: no testnet transactions before that |

The registry address is CreateX's CREATE3 address for the deployer's guarded salt
(`[deployer][0x00]["kakushi.fhe"]`, see `contracts/registry-address.json`):

| | deployer | registry |
|---|---|---|
| current | `0x2c76aA36C88E89734223A5Cf0c54697782B9C24C` (Kakushi deployer, `DEPLOYER_PK` in the root `.env.testnet`) | **`0x0047D047510cd9201470c7Eb85cE0FdF69d7De90`** |
| before 2026-10-12 | `0x844bBB648B6e3214452c774D3495dC1bD1295a86` (Fhish deployer) | `0xEc4A6767F7884712C0B19ada05F9C98e5fd341E7` (never deployed on testnet) |

`KakushiConfig.KAKUSHI_FHE_REGISTRY` hard-codes it; `test_RegistryIsCreate3AddressOfKakushiDeployer` re-derives it.
Testnet signer keys live in `.secrets/signers.testnet.json` (gitignored, mode 600): 3 input signers, 3 KMS
signers, the FHE relayer. `scripts/deploy-testnet.ts` creates the file if it is missing. The local fork keeps
using `.secrets/signers.json`.

## 1. Contracts on Monad testnet (10143)

The root orchestrator does steps 1 (core + apps) for the whole stack:
`node scripts/deploy-testnet.ts --dry-run` (default; simulates on throwaway forks), then `--broadcast`.
It writes `contracts/deployments/testnet.json` (core) and the root `config/generated/fhe.testnet.json` (core +
apps). By hand, the core alone:

Pick the CRE forwarder. The oracle stores it as an immutable, so this choice is final per deployment:

- `0xB9F79d863261869B234c481D1f9A7af84AeAd192`: **MockKeystoneForwarder** (simulation). `cre workflow
  simulate --broadcast` writes through it. Recommended for the hackathon: the bounty accepts CLI
  simulation, and the oracle's KMS-signature check makes an open forwarder safe (it can only deliver
  results the KMS signed).
- `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`: production KeystoneForwarder, which needs a deployed
  workflow and `cre account access` approval.

```bash
set -a; . ../.env.testnet; set +a        # DEPLOYER_PK: read by the script from the environment
cd contracts
DEPLOYER=0x2c76aA36C88E89734223A5Cf0c54697782B9C24C \
INPUT_SIGNERS=$(jq -r '[.inputSigners[].address]|join(",")' ../.secrets/signers.testnet.json) \
KMS_SIGNERS=$(jq -r '[.kmsSigners[].address]|join(",")' ../.secrets/signers.testnet.json) \
INPUT_THRESHOLD=2 KMS_THRESHOLD=2 \
CRE_FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 \
REGISTRY_SALT=$(jq -r .salt registry-address.json) KAKUSHI_FHE_NETWORK=testnet \
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast --slow \
  --sender 0x2c76aA36C88E89734223A5Cf0c54697782B9C24C
```

Check: `deployments/testnet.json` has `registry == 0x0047D047510cd9201470c7Eb85cE0FdF69d7De90`.
Verify on MonadVision/Sourcify (`forge verify-contract --verifier sourcify --chain 10143 …`).
Then deploy the apps with the same calls `scripts/e2e-local.ts --keep` makes, and write
`deployments/testnet-apps.json`:
- **Kakushi Confidential**: `KakushiPayToken(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC /* AUSD */, "Confidential AUSD", "cAUSD")`
  as `causd`, and optionally one over Circle USDC `0x534b…43A3`.
- Playground extras: auction, cUSDC wrapper, dark OTC.
Demo funds: Agora's faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` `requestFunds(address)` gives 10,000
AUSD (60 s global cooldown); Circle's faucet gives testnet USDC.

## 2. Engine, coprocessor, gateway

```bash
engine/bin/kakushi-fhe-engine serve --dir .kakushi-fhe --port 8899           # same keys as local: .kakushi-fhe/keys
KAKUSHI_FHE_NETWORK=testnet KAKUSHI_FHE_SECRETS=.secrets/signers.testnet.json RPC_URL=https://testnet-rpc.monad.xyz DELIVER=both \
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
