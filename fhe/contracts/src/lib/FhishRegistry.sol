// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FhishConfigStruct} from "./FhishTypes.sol";
import {FhishErrors} from "./FhishErrors.sol";

/// @title FhishRegistry: where any contract finds the Fhish deployment on this chain.
/// @notice Deployed with CREATE3 (CreateX) so it has the same address on every chain; FhishConfig
///         reads it in the constructor. Set once, then immutable.
contract FhishRegistry {
    address public immutable owner;
    FhishConfigStruct internal _config;
    bool public isSet;

    event ConfigSet(address acl, address executor, address inputVerifier, address oracle);

    constructor(address owner_) {
        owner = owner_;
    }

    function setConfig(FhishConfigStruct calldata c) external {
        if (msg.sender != owner) revert FhishErrors.NotOwner();
        if (isSet) revert FhishErrors.NotOwner();
        _config = c;
        isSet = true;
        emit ConfigSet(c.acl, c.executor, c.inputVerifier, c.oracle);
    }

    function config() external view returns (FhishConfigStruct memory) {
        if (!isSet) revert FhishErrors.FhishNotConfigured();
        return _config;
    }
}
