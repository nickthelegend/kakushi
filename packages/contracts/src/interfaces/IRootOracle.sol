// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Cross-chain hook for KakushiPool: roots of the same pool class (same asset and
///         denomination) on OTHER chains, so a note deposited on chain A can be withdrawn on B.
/// @dev    TODO(cross-chain): not implemented. Before any pool is deployed with a non-zero
///         root oracle, all of the following must exist:
///           1. root attestation: remote roots posted by an attested source (e.g. the CRE
///              workflow + AttestationOracle on the Monad hub), relayed to every spoke;
///           2. nullifier synchronisation: a nullifier spent on one chain must be unspendable on
///              every other chain (otherwise one deposit withdraws once per chain);
///           3. liquidity: the withdrawing chain's pool must be funded for remote deposits.
///         Every deployment today passes address(0), and the pool then only accepts its own roots.
interface IRootOracle {
    /// @return true if `root` is an attested root that `pool` may accept as if it were its own.
    function isKnownRoot(address pool, bytes32 root) external view returns (bool);
}
