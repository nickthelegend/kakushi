# Sponsor integration gaps

Checkpoint: 2026-10-08. Keep these claims separate from local implementation and test results.

| Integration | Current evidence | Remaining gate |
| --- | --- | --- |
| Chainlink CRE | CRE source and a local attestation runner exist. | Real CRE CLI simulation and authenticated DON deployment evidence are not established by that runner. Do not call it DON execution. |
| Privy | App/provider and server wallet integration source exist. | Real configured app login, delegated signing, policy enforcement, and sponsorship remain untested. Public wallet access is not proof of Privy signing. |
| Cleanverse | PayoutRouter has an optional compliant-token gate and local validator tests. | Validator ABI is inferred from earlier teams. Canonical sponsor ABI, pool registration and actual A-Passes are blocked on onboarding. See [integration gate](CLEANVERSE-INTEGRATION.md). |
| Envio | Real HyperIndex v3 configuration, schema, lifecycle handlers, derived MakerStats/RouteStats and typed GraphQL reader pass codegen, generated API TypeScript and seven offline tests. The separate RPC indexer verifies nine actual local source payments, batch receipt selection, route statistics and confirmed-head attestation lag. | Docker/HyperSync/Cloud runtime and live GraphQL/count verification remain untested. Direct native transfers without logs and confirmed-head lag use the RPC fallback; general GraphQL history and scalable aggregation are documented extensions. See the [Envio runbook](../packages/indexer/envio/README.md); offline event tests are not managed deployment evidence. |

All four local fork scenarios and a separate browser-generated proof/submission passed; see [verification](VERIFICATION.md). A test fixture must not be presented as sponsor verification, and a missing or reverting identity check must remain unknown rather than verified.
