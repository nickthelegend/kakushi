# Kakushi Confidential indexer (Envio HyperIndex)

Real-time analytics for **Kakushi Confidential**, confidential stablecoin payments on Monad: every payment, salary,
pay link, payment request and cash-out, plus the KMS reveal pipeline and the FHE coprocessor behind them. It powers the
app's live **Activity** page (`/activity`) through `app/src/app/api/indexer/route.ts`.

**Privacy rule: no decrypted amount is ever indexed.** A Kakushi Confidential amount is an FHE ciphertext handle
(`euint64`). The indexer stores the handle and nothing else. Only the amounts the chain already makes
public are stored as numbers: wraps (deposit into the private pool) and settled unwraps (cash-out).
Oracle cleartexts, trivial-encrypt constants and scalar FHE operands are deliberately ignored, and
`scripts/verify.ts` checks that no oracle cleartext shows up in the API.

HyperIndex **3.14** (V3 config: `chains:`, `indexer.onEvent`, handler-level `fields`), TypeScript handlers.

## What is indexed

| Contract | Events |
| --- | --- |
| `KakushiPayToken` (cAUSD over Agora AUSD; cUSDC too: any number of Kakushi Confidential tokens, one address list) | `Wrapped`, `UnwrapRequested`, `Unwrapped`, `ConfidentialTransfer`, `Paid`, `LinkCreated`, `LinkClaimed`, `LinkRefunded`, `PayrollRun`, `OperatorSet`, `PaymentRequested`, `RequestPaid`, `RequestCancelled` |
| `KakushiDecryptionOracle` | `DecryptionRequested`, `DecryptionFulfilled` |
| `KakushiExecutor` (symbolic FHE executor, every Kakushi app) | `FheOp`, `FheSelect`, `TrivialEncrypt`, `VerifyInput`, `Rand` |

## Derived and aggregated entities (`schema.graphql`)

| Entity | What it holds |
| --- | --- |
| `Payment` | one confidential value movement: `kind` PAY / PAYROLL / LINK_CLAIM / TRANSFER, from, to, **`amountHandle`** (ciphertext), ref, payroll run, link, block, time, tx |
| `PayLink` | state machine OPEN -> CLAIMED / REFUNDED, escrowed handle, claimer, `claimSeconds`, `claimBlocks`, the claim payment |
| `PayRequest` | a payment request (encrypted invoice): payee, payer, ref, expiry, `dueHandle` (the asked amount as a ciphertext, never a number), `payAttempts`, `lastPaidAt`, `cancelled`. There is deliberately no "paid" flag: `payRequest()` moves the outstanding amount or 0 (balance short), and only payee and payer can tell which by decrypting `requestDue` |
| `PayrollRun` | employer, operator (`viaOperator` when a server wallet ran it), count, ref, its salaries (`@derivedFrom`) |
| `Reveal` | each KMS public-decryption round trip: requester app, handle count, `latencySeconds`, `latencyBlocks`, delivery `path` (Kakushi relayer vs Chainlink CRE forwarder), `callbackOk` |
| `Unwrap` | cash-out lifecycle: burned handle, linked `Reveal`, settled public amount, `settleSeconds` |
| `Account` | payments sent / received, distinct counterparties, payrolls run / operated / received, links created / claimed / refunded, requests sent / received, public wrapped / unwrapped, first / last seen; `sent`, `received`, `linksSent`, `payrolls`, `unwraps`, `requestsOut`, `requestsIn` relations |
| `PayPair` | who-pays-whom graph: one row per ordered pair with a count (never an amount) |
| `Token` | per Kakushi Confidential token: public wrapped, unwrapped, **TVL**, wraps, cash-outs, payments |
| `FheOpStat`, `FheCallerStat` | coprocessor load per opcode and per calling contract (which apps use FHE, how much) |
| `DailyStats` | UTC-day rollup: payments by kind, unique payers, payroll runs, links, requests (created / pay attempts / cancelled), wraps, reveals + latency, FHE ops |
| `GlobalStats` | protocol totals: payments by kind, unique payers, accounts, payroll runs (+ via operator), links created / claimed / open, **avg and median claim time**, requests / request pay attempts / requests cancelled, public TVL, reveals (pending, per path, failed callbacks, **avg latency in seconds and blocks**), FHE ops |

Internal (`@internal`, not in the API): `TxScratch` (links a `ConfidentialTransfer` to the higher-level
event that follows it in the same tx), `PayerDay` (daily unique payers), `ClaimSamples` (sorted claim
times for the median).

### How payments are classified

Every balance move emits `ConfidentialTransfer(from, to, handle)`. The handlers read it in context:

- mint (`from = 0`) and burn (`to = 0`) are wraps / unwraps, not payments (the burn handle is kept for the `Unwrap`);
- moves into the token are pay-link escrow; moves out of it are a link claim or refund, resolved by the `LinkClaimed` / `LinkRefunded` that follows (the claim becomes a `LINK_CLAIM` payment from the link's sender);
- anything else is a `TRANSFER`, upgraded to `PAY` when a `Paid` with the same handle follows, and to `PAYROLL` when the tx ends with a matching `PayrollRun`. Counters move with the reclassification, so each payment is counted exactly once.
- `payRequest()` moves value with a plain `ConfidentialTransfer` (payer -> payee), so it stays a `TRANSFER` payment; the `RequestPaid` that follows only bumps the request's `payAttempts` (it may have moved an encrypted 0).

## Files

```
config.yaml                 GENERATED by scripts/configure.ts (local fork or Monad testnet)
schema.graphql              entities above
src/handlers/*.ts           KakushiPayToken, KakushiDecryptionOracle, KakushiExecutor
src/lib/unit.ts             per-event unit of work (load aggregates once, write once)
src/lib/common.ts           ids, lazy entity creation, median
src/network.generated.ts    GENERATED: token metadata + Chainlink CRE forwarder address
test/indexer.test.ts        handler tests (Envio test indexer, simulated events)
scripts/configure.ts        writes config.yaml + src/network.generated.ts from contracts/deployments/*.json
scripts/activity.ts         generates real activity on the LOCAL fork (dev keys)
scripts/verify.ts           recomputes every aggregate from eth_getLogs and diffs it with the GraphQL API
EVIDENCE.md                 captured end-to-end run (queries + responses)
```

## Run it locally (against the anvil fork of Monad testnet)

Needs Node >= 22, pnpm, Docker (for Postgres + Hasura) and the Kakushi local stack (anvil `:18810`,
gateway `:8890`, deployments in `contracts/deployments/local*.json`).

```bash
cd indexer
pnpm install                 # standalone workspace (indexer/pnpm-workspace.yaml)
pnpm configure               # KAKUSHI_FHE_NETWORK=local by default -> config.yaml (RPC source, start = deployBlock)
pnpm test                    # 7 handler tests
```

Start the indexer, either way:

**A. `envio dev` (Envio manages Postgres + Hasura in Docker).** Override the default ports if 5433/8080
are taken (not exercised for EVIDENCE.md, which used B):

```bash
ENVIO_PG_PORT=5442 HASURA_EXTERNAL_PORT=8892 ENVIO_INDEXER_PORT=9908 ENVIO_TUI=false pnpm dev
```

Note: `envio dev` uses fixed global container names (`envio-postgres`, `envio-hasura`). If another Envio
project on the machine already owns them, use B, or set a per-project `ENVIO_PG_SCHEMA` (see Envio's
"running multiple indexers" guide).

**B. Bring your own Postgres + Hasura, then `envio start`** (what EVIDENCE.md used):

```bash
# Postgres on 5442 (any Postgres 16+; database envio-dev, user postgres / testing)
docker run -d --name kakushi-fhe-envio-hasura -p 127.0.0.1:8892:8080 \
  -e HASURA_GRAPHQL_DATABASE_URL=postgres://postgres:testing@host.docker.internal:5442/envio-dev \
  -e HASURA_GRAPHQL_ADMIN_SECRET=testing -e HASURA_GRAPHQL_UNAUTHORIZED_ROLE=public \
  -e HASURA_GRAPHQL_ENABLE_CONSOLE=true -e HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true \
  hasura/graphql-engine:v2.43.0
ENVIO_TUI=false ENVIO_PG_HOST=127.0.0.1 ENVIO_PG_PORT=5442 ENVIO_PG_USER=postgres ENVIO_PG_PASSWORD=testing \
ENVIO_PG_DATABASE=envio-dev HASURA_GRAPHQL_ENDPOINT=http://localhost:8892/v1/metadata \
HASURA_GRAPHQL_ADMIN_SECRET=testing ENVIO_INDEXER_PORT=9908 pnpm start      # add -r to re-index from scratch
```

Then:

```bash
pnpm activity                # wrap, pay, transfer, 3 pay links (2 claimed), operator payroll, 3 payment requests (paid / short / cancelled), unwrap + reveal
node scripts/verify.ts       # chain vs indexer, every aggregate; exits 1 on any mismatch
open http://localhost:8892/console      # Hasura (admin secret: testing)
```

GraphQL: `http://localhost:8892/v1/graphql` (public role, read-only). The app reads it through
`/api/indexer` (`KAKUSHI_FHE_INDEXER_URL`, default `http://localhost:8892/v1/graphql`) and renders it at
`http://localhost:3810/activity`.

Example query:

```graphql
{
  GlobalStats { payments payrollPayments linksClaimed linkClaimMedianSeconds publicTvl revealAvgLatencySeconds fheOps }
  Payment(order_by: { blockNumber: desc }, limit: 5) { kind from_id to_id amountHandle ref }
}
```

## Monad testnet on Envio Cloud (HyperSync)

Monad testnet is a native HyperSync chain (`https://10143.hypersync.xyz`), so the testnet config has no
RPC: HyperIndex syncs over HyperSync.

```bash
KAKUSHI_FHE_NETWORK=testnet pnpm configure     # reads contracts/deployments/testnet.json + testnet-apps.json
```

**User actions (need your accounts; not done here):**

1. Deploy Kakushi + Kakushi Confidential to Monad testnet so `contracts/deployments/testnet.json` (oracle, executor,
   creForwarder, deployBlock) and `testnet-apps.json` (`causd`, optionally `cusdc`) exist
   (see `docs/DEPLOY-LATER.md`).
2. Run `KAKUSHI_FHE_NETWORK=testnet pnpm configure` and commit the regenerated `config.yaml` and
   `src/network.generated.ts` (plus `pnpm-lock.yaml`).
3. Log in at https://envio.dev/app/login with GitHub, install the Envio Deployments GitHub App on the repo,
   **Add Indexer** with root directory `indexer`, config file `config.yaml`, and a deployment branch.
4. Push to that branch; Envio Cloud builds and syncs it. Copy the deployment's GraphQL endpoint.
5. Set `KAKUSHI_FHE_INDEXER_URL=<that endpoint>` for the app (e.g. on its host) so `/activity` reads the cloud indexer.
6. For local HyperSync runs (not needed on Envio Cloud), create an API token at
   https://envio.dev/app/api-tokens and set `ENVIO_API_TOKEN`.

The handlers import nothing outside `indexer/` (an Envio Cloud monorepo requirement). Only
`scripts/activity.ts` and `scripts/verify.ts` use the repo's SDK, and they are not part of the build.

## Extending

- Another Kakushi Confidential token: add its key to `KAKUSHI_FHE_PAY_TOKENS` (default `causd,cusdc`) and re-run `configure`.
- Another chain (e.g. Monad mainnet, 143): add a `chains:` entry; every id is already chain-prefixed and
  `Account` / `GlobalStats` aggregate across chains.
