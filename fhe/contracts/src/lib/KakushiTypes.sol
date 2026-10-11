// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Encrypted types are 32-byte handles. The last byte is the type tag; the ciphertext lives
/// off-chain in the Kakushi coprocessor (real Zama tfhe-rs), never on Monad.
type ebool is bytes32;
type euint32 is bytes32;
type euint64 is bytes32;

/// Client-encrypted inputs, bound into contracts with an input proof (FHE.fromExternal).
type externalEbool is bytes32;
type externalEuint32 is bytes32;
type externalEuint64 is bytes32;

library KakushiType {
    uint8 internal constant EBOOL = 0;
    uint8 internal constant EUINT32 = 3;
    uint8 internal constant EUINT64 = 4;

    function typeOf(bytes32 handle) internal pure returns (uint8) {
        return uint8(uint256(handle));
    }
}

/// Addresses of a Kakushi deployment, read from KakushiRegistry.
struct KakushiConfigStruct {
    address acl;
    address executor;
    address inputVerifier;
    address oracle;
}
