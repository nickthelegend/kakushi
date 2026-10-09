# Kakushi local RPC indexer

This package provides durable observed transfer history and maker statistics from the deployed contracts. It is a read-only RPC indexer using Node's built-in SQLite, not an Envio HyperIndex deployment. The sibling `envio/` package now supplies genuine Envio HyperIndex v3 configuration/schema/handlers and offline codegen/tests. HyperSync/Cloud execution and live sponsor evidence remain separate gates.

## Run locally

Use Node >=22.18 and the repository's existing root dependencies (`pnpm install` at the repository root). The root workspace intentionally excludes this package; run it directly:

```sh
cd packages/indexer
KAKUSHI_NETWORK=local INDEXER_DB=.data/local.sqlite node src/main.ts
```

Deployment addresses and starting blocks come from `config/deployments`; local RPCs use the shared registry (ports 18710/18711/18712). Existing `<CHAIN_PREFIX>_RPC_URL` overrides follow the shared loopback restriction for the local network. This process never signs or submits transactions. It requires the locally deployed forks and contracts; it does not start forks itself.

`INDEXER_HOST` defaults to `127.0.0.1`; `INDEXER_PORT` defaults to 4201. Optional `INDEXER_CORS_ORIGIN` sets one allowed origin. Do not expose raw RPC history publicly without applying the deployment's access policy.

The scanner commits each block's events and cursor atomically, requests at most 100 blocks per chain per pass, and retries after two seconds. Testnet Monad uses the finalized tag; spoke testnets use the registry's attestation confirmation counts (a demo assumption, not finality). Local forks index their current head. A persisted cursor hash change stops scanning rather than accepting orphan history. Stop the process, confirm the chain reset/reorg, then move aside/delete that network's SQLite database and restart to replay from deployment blocks. Never reuse one database across network/fork resets. Health reports errors; a successful HTTP response alone does not mean the scanner is caught up.

## Integration

- `GET /health`: `{ network, lastSuccessfulScan, lastError, cursors: [{chainId,block?,hash?}] }`.
- `GET /transfers?sender=0x...&maker=0x...&limit=50&offset=0`: `{total,items}`. Filters are optional; `limit` is capped at 200. Each item has `srcRef` (canonical bytes32 hex), `source`, `payout`, `dispute`, `status`, `latencyMs`.
- `GET /makers`: `{items}` with `maker`, `observedSources`, `fills`, `refunds`, `observedFillRate`, `disputesLost`, `p50LatencyMs`, `p95LatencyMs`, `volumeByToken`, `marginByToken`.
- `GET /routes`: `{items}` with observed registered route identity, current active state, source/fill/refund/pending counts, observed fill rate, raw source and destination fill volume, dispute losses and latency percentiles. Sources match maker + source chain/token + the encoded ident code from actual PairRegistered events; unmatched payments are retained in `/transfers` and omitted from route aggregates.
- `GET /attestations`: `{items}` with separate source (kind 1) and payout (kind 2) window counts, latest coverage frontier, observed confirmed head (including observation time), indexed block, and nullable `confirmedLagBlocks`/`confirmedLagSeconds`. Lag compares the latest window frontier with the last observed confirmed head, not an unobserved public latest tip; check the observation time and `/health` before treating it as current.
- `GET /events?limit=50&offset=0`: raw decoded contract events, including PairRegistered/parameter updates, attestation windows, dispute and margin events.

`src/client.ts` exports an `IndexerClient` and uses type-only storage imports, so browser callers do not load `node:sqlite`. All integers inside event args that were Solidity bigints are serialized as decimal strings. Event envelope contains chainId, blockNumber, blockHash, timestamp (seconds), txHash, logIndex, name, args. Source args retain SDK fields (sender, maker, recipient, token, gross, via, srcChainId). Payout kinds are 2=fill and 3=refund. `source-unobserved` identifies dispute-only joins; payout-only records retain a null source and latency. App code must tolerate these nulls.

Statistics describe observed events since deployment, not a maker's promises or market-wide success. Fill rate is observed source payments with a fill divided by observed source payments; pending payments remain in the denominator. Latencies use source/payout block timestamps, not submission wall-clock times, and are only available for joined observations. Volume is raw destination-token units grouped by `chainId:token`; tokens are never added together or converted to USD. Margin is reconstructed from emitted totals/withdrawals/slashes; absent margin history is omitted rather than fabricated. Dispute states supersede payout states while preserving the underlying payout.

## Coverage and limits

Indexes deployed SourceRouter, PayoutRouter, EBC, MDC, DisputeModule and AttestationOracle logs. Raw configured-USDC and direct native transfers are recognized using SDK source-payment rules; native payments are found by scanning full block transactions. Failed transactions are ignored. Current registered maker addresses are used during replay. SDK `findSourcePayments` recognizes every supported payment log in a transaction, retaining each log index and distinct source reference; the singular `findSourcePayment` remains a first-payment compatibility helper. Router token forwarding logs are excluded, and native router payments are represented by their PaymentEncoded logs rather than duplicated direct native payments. The watchtower explicit `/watch` endpoint tracks the entire recognized batch and returns `srcRefs` alongside its compatible first `srcRef`. The maker and automatic watchtower scans already iterate all adapter payment logs. Adapter proof input selection accepts an optional log index for an individual batch payment. Only the configured USDC and native token are covered by the raw-transfer path. Route and attestation projections derive entirely from persisted events/head observations. Route statistics do not classify unmatched codes into invented routes, and window coverage reports the latest attested frontier rather than claiming independently verified contiguous proof coverage. This simple projection queries observed rows in memory and is suited to local demos, not large historical datasets.

No public testnet transactions, deployment, Envio Cloud setup, or production readiness are implied by these checks.

## Verification and evidence

```sh
../../node_modules/.bin/vitest run --maxWorkers=1
../../node_modules/.bin/tsc --noEmit
```

Eleven indexer offline tests cover actual ABI decoding and multi-source scanner ingestion, fail-closed cursor mismatch, SQLite restart/replay idempotency, atomic rollback, cross-chain out-of-order joins, refunds, dispute loss, margin slashes, percentiles, route/code grouping, distinct source/payout coverage lag, and typed HTTP client failure handling. Four additional SDK tests exercise actual batch USDC and SourceRouter ABI logs and native/reverted/removed paths; an adapter test verifies batch proof leaf selection by log index. SDK/adapters combined suite: 24 passing tests. SDK, adapters, watchtower and indexer typechecks pass.

Final local integration on 2026-10-08: all three chain cursors advanced without scan errors; nine actual source payments joined to six fills, one refund and two slashed disputes. Maker B had seven observed sources/six fills/one refund; Maker A had two source payments/two losses. Eight registered Maker routes and six source/payout attestation projections were observed. `/activity`, `/makers` and `/attestations` consumed real indexer data in the final mobile browser sweep. Snapshot and local hashes are recorded by the orchestrator. This remains local RPC evidence, not Envio Cloud.

## Remaining external gates

The local RPC implementation and the offline-validated `envio/` package do not establish sponsor-specific Envio HyperSync runtime evidence, managed HyperIndex/Cloud deployment, or live testnet traffic evidence by themselves. Those require separate configuration, deployment credentials and authorized network execution. Source discovery covers configured USDC, direct native transfers and deployed SourceRouter logs; arbitrary unsupported tokens or internal native calls without router events require additional adapters/trace indexing. No sponsor gate is marked complete by the offline tests.
