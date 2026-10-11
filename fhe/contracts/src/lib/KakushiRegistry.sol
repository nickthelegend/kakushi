// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KakushiConfigStruct} from "./KakushiTypes.sol";
import {KakushiErrors} from "./KakushiErrors.sol";

/// @title KakushiRegistry: where any contract finds the Kakushi deployment on this chain.
/// @notice Deployed with CREATE3 (CreateX) so it has the same address on every chain; KakushiConfig
///         reads it in the constructor. Set once, then immutable.
contract KakushiRegistry {
    address public immutable owner;
    KakushiConfigStruct internal _config;
    bool public isSet;

    event ConfigSet(address acl, address executor, address inputVerifier, address oracle);

    constructor(address owner_) {
        owner = owner_;
    }

    function setConfig(KakushiConfigStruct calldata c) external {
        if (msg.sender != owner) revert KakushiErrors.NotOwner();
        if (isSet) revert KakushiErrors.NotOwner();
        _config = c;
        isSet = true;
        emit ConfigSet(c.acl, c.executor, c.inputVerifier, c.oracle);
    }

    function config() external view returns (KakushiConfigStruct memory) {
        if (!isSet) revert KakushiErrors.KakushiNotConfigured();
        return _config;
    }
}
