# Local verification — 2026-10-08

Real local chain execution, not product fixtures. Three pruned Anvil forks used Monad testnet (10143), Sepolia (11155111), and Base Sepolia (84532). Funding used labelled local Anvil balance operations. CRE used workflow logic and MockKeystoneForwarder, not a DON.

## Gates

- 50 Foundry tests pass, zero failures/skips; includes 8 DisputeProofs tests generating real Noir/UltraHonk proofs through FFI and margin invariants. Command: `forge test -j 1`.
- 3 Noir library tests pass; the circuit packages define no standalone Nargo tests. Contract tests and runtime execution exercise their proofs.
- 61 package tests pass: config 6, attest-core 14, SDK 20, adapters 4, app 11, Maker 6. Watchtower has no unit tests and is not counted as a test pass.
- 11 RPC indexer tests pass, including durable replay, block atomicity, route/attestation projections and cursor mismatch rejection. Indexer TypeScript passes separately.
- The separate Envio HyperIndex v3 package passes genuine codegen, generated-handler TypeScript and seven offline lifecycle/GraphQL-client tests. Derived MakerStats and RouteStats preserve exact token amounts, replay stability and missing versus zero latency. Docker, HyperSync and Cloud were not started. Direct native transfers without logs and confirmed-head lag remain covered by the RPC scanner. See [Envio runbook](../packages/indexer/envio/README.md).
- Recursive package/root TypeScript, app TypeScript and final single-worker app production build pass (9 static pages plus API/transfer handlers).
- Repeated stack startup correctly fails before changing existing PID ownership records.

## Actual transactions

The initial four-scenario `pnpm demo --keep` passed in 193 seconds; a fresh replay on the final sources passed all four in 201 seconds. A: received 4.962545 USDC on Monad. B: the offline Maker's margin compensated 7.009001 USDC, while Maker B independently filled 1.967045 USDC; real proof 725 ms in the final replay (931 ms initially). C: invalid-code payment 3.009999 USDC refunded 2.97, with 0.039999 fee/code dust. D: native payment 0.010000000000009003 ETH paid 0.00987525 ETH on Base Sepolia.

A real browser-originated USDC transfer settled. With the Watchtower stopped, another unpaid local payment was disputed manually through the browser: UltraHonk proof 27 public inputs, 8,768 bytes, 8,508 ms on the final sources (9,784 ms initially). Opening the bond and submitting the proof succeeded, compensating the sender from Maker margin. The final test selected the exact receipt log with `?log=0`.

The final persistent indexer snapshot observed 9 source payments, 6 fills, 1 refund and 2 slashes; all three cursors advanced with no scan error. It also records 8 registered Maker routes and 6 source/payout attestation projections. App history and Maker counts consume these observations.

The final browser pass exercised a custom-recipient SourceRouter approval/payment/payout (receipt log 2), a 10 USDC Maker margin approval/deposit and a 5 USDC timelocked withdrawal request. Reverse USDC Monad-to-Sepolia and native ETH Base-to-Sepolia both settled. Timelocked withdrawal execution is contract-tested, not claimed as browser execution. At 390×844, `/bridge`, `/activity`, `/makers`, `/attestations`, `/maker`, `/disputes` and the settled transfer page had no JavaScript exception or page overflow after fixes.

## Limits and cleanup

Not a security audit or production certification. Real Privy login/sponsorship, CRE CLI/DON evidence, Cleanverse canonical ABI/onboarding, Envio Cloud, public deployments and funded production/device tests remain separate gates. Full portfolio release status is recorded in the orchestrator's outputs.

All owned app/indexer/Maker/attester processes and three forks were stopped by PID. Local logs/databases remain in ignored `.stack`/`.data`; no secret values were exported. All hashes in local evidence are fork hashes and must not be presented as public explorer receipts.
