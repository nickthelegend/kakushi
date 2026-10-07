// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice srcRef = keccak256(abi.encode(srcChainId, txHash, logIndex)) >> 8, so it fits the
///         BN254 scalar field. Native transfers (no log) use logIndex = type(uint32).max.
library SrcRef {
    uint32 internal constant NATIVE_LOG_INDEX = type(uint32).max;

    function compute(uint64 srcChainId, bytes32 txHash, uint32 logIndex) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode(srcChainId, txHash, logIndex))) >> 8);
    }
}
