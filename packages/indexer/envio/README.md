# Kakushi Envio HyperIndex v3 package

Real HyperIndex configuration, generated types and event handlers for Kakushi's chains (10143, 11155111, 84532, and 421614 / 11155420 when deployed; the generated `config.yaml` lists only the chains with a deployment record). Envio is pinned to 3.12.1. This directory is separate from the SQLite RPC fallback and has its own dependencies. No Docker, Hasura, HyperSync, Cloud or public testnet indexing run is claimed by the offline verification below.

## Configure and validate

From the repository root, install the existing workspace dependencies first. Then enter this directory and install its isolated dependencies with your package manager. It is excluded from the root pnpm workspace by design; a local npm install can be used here. The deployment-to-config script reads the actual repository deployment JSONs and shared contract ABIs, and therefore runs inside this repository after the root installation.

```sh
cd packages/indexer/envio
npm install
node scripts/configure.ts local
npm run codegen
npm run typecheck
npm test
```

Configuration must be regenerated after each local deploy/reset. `config.yaml` currently records actual local deployment addresses/start blocks from `packages/contracts/deployments/local`, not a claimed testnet deployment. Local mode uses RPC `for: sync`, never HyperSync against public chain data, and retains the three forks' actual chain IDs. Deployment loader errors are fatal; the generator does not invent absent addresses.

For a separately authorized testnet indexing run, first supply actual deployment JSONs under `packages/contracts/deployments/testnet`, then run `node scripts/configure.ts testnet`. That mode leaves HyperSync selection to Envio's supported-chain configuration and supplies the shared RPCs as fallbacks. HyperSync needs `ENVIO_API_TOKEN` from Envio's dashboard. A testnet fork address is not automatically a publicly deployed contract address.

The codegen validation in this session reused an existing local Envio 3.12.1 installation through an ignored `node_modules/envio` symlink; it did not download packages. Remove that symlink before a fresh isolated installation if needed. Generated `.envio/` is ignored; regenerate it rather than copying types from another project. `envio-env.d.ts` is genuinely emitted by codegen.

## Entities and canonical lifecycle

Handlers use the documented v3 `indexer.onEvent`, generated context entity methods and Envio's cross-chain entity defaults. `Transfer.id` is the canonical SrcRef.sol bytes32 reference; it is shared across source/payout chains. Raw entity IDs retain their emitting chain, transaction hash and log index.

- `SourcePayment`: every supported USDC or SourceRouter payment, including router native payments and multiple source logs per transaction.
- `Payout`: fills (kind 2) and refunds (kind 3), preserving amount/token/recipient and chain identity.
- `Transfer`: source/payout join, nullable missing observation, actual block-timestamp latency, and dispute terminal state. A payout arriving before its source is retained and joined later.
- `Dispute`: opening and slashed/maker-proven/expired outcomes; observed compensation and actual paid/reward values.
- `Maker`, `Pair`: actual hub registrations and active state, used to distinguish source payments from maker payouts.
- `Margin`, `MarginEvent`: actual deposit/withdraw totals and net paid slashes, without inventing a missing prior balance.
- `AttestationWindow`: separate source/payout windows with the real source chain, coverage, root and leaf count.
- `MakerStats`: deterministic observed source/fill/refund/pending/dispute/slash counts, latency sample count and p50/p95, nullable observed fill rate in basis points, and exact source/fill/refund raw volume maps keyed by `chainId:lowercaseToken`.
- `RouteStats`: the same lifecycle measures per registered canonical pair, with source/destination raw volumes kept in their respective token units. Sources match maker, source chain/token, amount ident code, and registration time. Ambiguous or unregistered routes are left unassigned rather than fabricated; a payout to the wrong destination chain/token does not count as a fill on that route.

There are no uncached external calls or wall-clock mutations inside handlers. Entity reads/writes follow Envio's preload model; no separate counter is incremented outside persisted state. Source ref encoding is dependency-light for hosting and tested against Kakushi's canonical core implementation.

Raw USDC transfers are accepted only to registered makers; maker-originated payouts and transfers forwarded by SourceRouter are excluded, preventing double counting. SourceRouter custom recipients remain distinct from the sender.

Direct native transfers without logs remain covered by the sibling RPC block scanner, not this log-only Envio package. Complete direct-native coverage here would require a block/transaction ingestion integration with the supported Envio effect/block APIs. Missing hub registration history (a start block too late) also prevents raw-payment recognition; always use real deployment start blocks. This package exposes MakerStats and RouteStats through GraphQL. Confirmed-head attestation lag remains exposed by the SQLite fallback; this Envio package currently persists raw AttestationWindow coverage without a live head/lag projection.

## Offline checks completed

Actual `envio codegen` succeeds against this configuration and schema, and TypeScript succeeds against its generated APIs. Seven offline tests cover genuine Envio `createTestIndexer` lifecycle replays, canonical encoding comparison and mocked HTTP client behavior:

1. Cross-chain payout-first arrival, router batches, distinct source refs, latency, dispute loss, margin slash and attestation windows.
2. Raw USDC batches, router forwarding deduplication and exclusion of maker-originated payouts.
3. SrcRef equality with Kakushi's core encoding across chains and log indices.
4. Refund, maker-proven and expired dispute states, without fabricating a missing source or latency.
5. Statistics idempotency: Envio rejects an already processed simulated event and leaves aggregates unchanged; a fresh replay with reversed source/payout arrival yields identical totals, including a real observed zero-latency sample.
6–7. Typed GraphQL client normalization, exact raw amount strings, nullable samples, and explicit HTTP/GraphQL/missing-data failures.

These simulated events are tests, not live chain evidence.

## Run and external prerequisites

Only after coordinating the resource budget and local fork lifetime, start Docker and use `npm run dev`. Envio provisions its PostgreSQL/Hasura indexing environment; consult the generated runtime output for actual local endpoints rather than assuming a fixed GraphQL port. No Docker runtime was started during this implementation.

Envio Cloud deployment additionally requires an account, project/repository access, deployment environment and API token. A clean install/codegen/run on the target host plus live indexing/count verification remains necessary. Do not mark the sponsor's managed deployment or HyperSync evidence gates complete from codegen alone.

Primary references: [v3 event handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers), [configuration](https://docs.envio.dev/docs/HyperIndex/configuration-file), [testing](https://docs.envio.dev/docs/HyperIndex/testing).

## Derived statistics and reads

Each lifecycle update replaces one canonical Transfer, then derives statistics from observed transfer identities. It does not increment counters on callbacks, so preload, repeated state updates and fresh replays cannot inflate counts. Recomputing a maker's rows is suitable for demo-sized data; larger datasets require partitioned/per-transfer contributions or batched aggregation before production scaling.

`filled` and `refunded` count actually observed payout kinds; `slashed` counts observed terminal slash outcomes. They can overlap when a payout and dispute are both observed for one reference. `disputed` counts references with an observed dispute opening, including resolved outcomes. Fill rate uses filled references with known source divided by known sources; a payout-only observation contributes payout volume/count but does not invent a source, rate denominator or latency. Rates are floored integer basis points; no known sources yields null. Latency samples require both block timestamps and a nonnegative difference; clock-inverted observations remain without a latency sample. Zero is retained when timestamps actually match. The source/fill/refund volume maps contain decimal strings; different chains/tokens are never summed into one fungible amount or USD value.

`src/client.ts` provides a read-only `EnvioStatsClient` for the actual Hasura GraphQL endpoint:

```ts
const stats = new EnvioStatsClient(graphqlUrl);
const makers = await stats.makers(makerAddress);
const routes = await stats.routes(makerAddress);
```

The client uses case-sensitive `MakerStats`/`RouteStats` query roots, lowercase maker filters, a 200-row limit cap and a 10-second timeout. Generated Envio entity types are imported as types only. GraphQL BigInt values remain strings and nullable columns remain null. The client surfaces errors rather than returning fake empty statistics. These client tests use mocked HTTP responses; a live GraphQL endpoint/schema execution test remains part of the Docker/Cloud runtime gate.

Intentionally absent local code: direct logless-native ingestion in Envio, confirmed-head attestation lag inside Envio, a general transfer-history GraphQL client, and scalable incremental aggregation. The RPC fallback already covers direct native history and confirmed-head lag. These are separate from external Docker/Hasura/HyperSync/Cloud execution and public evidence gates.
