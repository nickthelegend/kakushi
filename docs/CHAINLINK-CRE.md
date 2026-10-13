# How Kakushi uses Chainlink CRE: the bridge's source of truth for other chains

*Kakushi · Monad Metropolis, Track 04 · live at https://kakushi.vercel.app*

Kakushi is the privacy provider for Monad. ZK hides *who* and FHE hides *how much*. Its cross-chain leg is a **Maker bridge**: you pay a Maker on one chain (Sepolia, say), and the Maker pays you on another (Monad), optionally to a one-time stealth address. Every Maker posts margin on Monad. The promise to users is: **if a Maker doesn't pay, you can prove it, and you're paid from its margin.**

That promise needs Monad to know what happened on other chains. Chainlink CRE is how it knows.

## The problem: proving that something did *not* happen

Proving that a payout happened is easy: show the log. Proving that a Maker did **not** pay is hard. The Monad hub has to trust a statement like "between blocks A and B on Sepolia, these were *all* the Maker payouts, and yours isn't among them". So it needs:
1. **complete** windows of another chain's history, with no gaps;
2. a **commitment** to each window that a ZK circuit can check inclusion or absence against;
3. a pipeline that runs **by itself**, chain by chain, without a trusted script someone runs by hand.

## How it works

### 1. One CRE workflow per chain, on a cron trigger

`packages/cre/src/attest-workflow.ts` is built with `@chainlink/cre-sdk`. `workflows/attest-monad`, `attest-sepolia` (and Base, Arbitrum, OP for the unfunded spokes) are one instance each, so every run stays inside CRE's 15-EVM-read quota:

```ts
cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCron)
```

Each run:
1. reads the hub (`EBC.allMakers()`, `AttestationOracle.lastPayoutToBlock(chain)`) with `EVMClient.callContract` at the finalized block;
2. finds the chain's safe head and the next **contiguous** block range (≤ 100 blocks, CRE's log-query limit);
3. calls `filterLogs` for `PayoutRouter.Payout`, `SourceRouter.PaymentEncoded` and USDC `Transfer(to = Maker)`;
4. normalizes them into **sorted Poseidon2 trees**, using the same `attest-core` code the Noir circuits' witnesses use, and encodes `Window[]`;
5. calls `writeReport` to `AttestationOracle.onReport` on the Monad hub.

### 2. The hub only accepts contiguous windows

```solidity
function onReport(bytes calldata metadata, bytes calldata report) external {
    if (msg.sender != forwarder) revert Errors.NotForwarder(msg.sender);
    if (expectedOwner != address(0)) { /* workflow owner from the report metadata must match */ }
    Window[] memory ws = abi.decode(report, (Window[]));
    for (uint256 i; i < ws.length; i++) _record(ws[i]);   // payout windows: fromBlock == last toBlock + 1
}
```

Because payout windows can't leave gaps, the hub always knows the complete set of payouts up to some block on each chain.

### 3. Disputes are proven against those roots

When a Maker misses its fill window, Kakushi's watchtower, or the user from the app's **Claim** page, builds a `payment_compliance` proof in Noir/UltraHonk. The proof shows the source payment is in an attested *source* window and that no compliant payout is in the attested *payout* windows covering the deadline. `DisputeModule` verifies the proof against the oracle's roots and slashes the Maker's margin to the sender. CRE is what makes that absence provable.

## Engineering notes

- **Monad caps `eth_getLogs` at 100 blocks**, and each attestation is a hub transaction billed on its gas limit. One 100-block window per transaction would cost about 15 MON an hour on Monad. The hosted runner covers longer spans per window (paging logs in 100-block chunks), batches quiet ranges every 2 hours, and sizes gas at the estimate + 15%. With the defaults it keeps the CRE workflow's exact limits.
- **Window rebuild had to page too.** The dispute builder re-reads a window's logs to rebuild its tree. It also had to page over the 100-block cap once windows grew longer (`fetchLogs` in `packages/sdk/src/attestations.ts`, tested).
- **The workflow owner and the transmitter are separate**, as in CRE. The oracle pins the workflow owner, while the hosted runner sends reports from its own key.

## The value it brought

Without CRE the bridge would be "trust the Makers". With it, the bridge is "trust the Makers, or prove they cheated and get paid from their margin". That guarantee is why a user can bridge into a privacy product without vetting each Maker. The CRE workflow is the orchestration layer that turns other chains' logs into commitments the Monad hub and the ZK circuits can act on.

## Live proof

- **CRE CLI simulation against live testnet state** (`cre workflow simulate`, CLI v1.36.0, read-only). The compiled workflow read the Monad hub and computed the next contiguous Sepolia window (11906267–11906366): [docs/evidence/cre-simulate-attest-sepolia-testnet.txt](evidence/cre-simulate-attest-sepolia-testnet.txt).
- **Windows on the Monad hub**, AttestationOracle [0xc50A…05Da](https://testnet.monadvision.com/address/0xc50A536E04DA4E2385e66fCf211820438F4905Da). For example, one report covering 10,000 Monad blocks (324,857 gas): [0x29f20989…00b8](https://testnet.monadvision.com/tx/0x29f20989d587fece820750cb8e71da9c4026107f3b238244a2367dce35f300b8). The live status is on the app's **Attestations** page.
- **A dispute slashed end to end on a local fork** (`pnpm demo`, scenario B): a dead Maker was proven unpaid against attested windows, and 7.009 USDC was paid back from its margin, with a 725 ms proof replay. **Fork only:** no bridge transfer has gone unpaid on testnet.

**Honest scope.** The on-chain windows are delivered by Kakushi's hosted runner (`packages/cre/local/runner.ts`). It runs the same `attest-core` logic as the workflow and delivers through Chainlink's `MockKeystoneForwarder` (`0xB9F7…D192`), the `cre workflow simulate --broadcast` path. The mock forwarder checks no signatures, so today these attestations are trusted from our runner, **not from a DON**. Deploying the workflow to a DON (with `cre account access`) and pointing the oracle at the production forwarder is the next step.

Code: [`packages/cre/src/attest-workflow.ts`](../packages/cre/src/attest-workflow.ts), [`packages/cre/workflows`](../packages/cre/workflows), [`packages/contracts/src/AttestationOracle.sol`](../packages/contracts/src/AttestationOracle.sol), [`packages/attest-core`](../packages/attest-core).
