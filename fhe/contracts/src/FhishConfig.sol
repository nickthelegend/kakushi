// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "./lib/FHE.sol";
import {FhishConfigStruct} from "./lib/FhishTypes.sol";

interface IFhishRegistry {
    function config() external view returns (FhishConfigStruct memory);
}

/// @title FhishConfig: make any contract confidential with one line.
/// @notice `contract MyApp is FhishConfig { ... }` and use `FHE.*`. The constructor reads the
///         Fhish deployment from FhishRegistry, which lives at the SAME address on every chain
///         (CREATE3 via CreateX), so the same source works on Monad testnet, mainnet and local forks.
abstract contract FhishConfig {
    address internal constant FHISH_REGISTRY = 0x2152Ed4dD179fCDe7FE0c2F35e274Ce4D7b0BaF9;

    constructor() {
        FHE.setConfig(IFhishRegistry(FHISH_REGISTRY).config());
    }
}

/// @notice Same, with explicit addresses (for chains without the registry, and for tests).
abstract contract FhishConfigManual {
    constructor(FhishConfigStruct memory c) {
        FHE.setConfig(c);
    }
}
