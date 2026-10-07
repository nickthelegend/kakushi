// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal reentrancy guard (storage flag; transient storage is avoided so
///         the same bytecode runs on every target chain).
abstract contract ReentrancyGuard {
    error Reentrancy();

    uint256 private _locked = 1;

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }
}
