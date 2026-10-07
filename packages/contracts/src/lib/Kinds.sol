// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared enums/constants. Leaf kinds must match packages/zk and packages/attest-core.
library Kinds {
    // obligation kinds (EBC.classify)
    uint8 internal constant NONE = 0;
    uint8 internal constant FILL = 1;
    uint8 internal constant REFUND = 2;

    // attested leaf kinds
    uint8 internal constant LEAF_SOURCE = 1;
    uint8 internal constant LEAF_PAYOUT_FILL = 2;
    uint8 internal constant LEAF_PAYOUT_REFUND = 3;

    // attestation window kinds
    uint8 internal constant WINDOW_SOURCE = 1;
    uint8 internal constant WINDOW_PAYOUT = 2;
}
