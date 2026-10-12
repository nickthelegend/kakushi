// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "./lib/FHE.sol";
import {KakushiConfigStruct} from "./lib/KakushiTypes.sol";

interface IKakushiRegistry {
    function config() external view returns (KakushiConfigStruct memory);
}

/// @title KakushiConfig: make any contract confidential with one line.
/// @notice `contract MyApp is KakushiConfig { ... }` and use `FHE.*`. The constructor reads the
///         Kakushi deployment from KakushiRegistry, which lives at the SAME address on every chain
///         (CREATE3 via CreateX), so the same source works on Monad testnet, mainnet and local forks.
abstract contract KakushiConfig {
    address internal constant KAKUSHI_FHE_REGISTRY = 0x0047D047510cd9201470c7Eb85cE0FdF69d7De90;

    constructor() {
        FHE.setConfig(IKakushiRegistry(KAKUSHI_FHE_REGISTRY).config());
    }
}

/// @notice Same, with explicit addresses (for chains without the registry, and for tests).
abstract contract KakushiConfigManual {
    constructor(KakushiConfigStruct memory c) {
        FHE.setConfig(c);
    }
}
