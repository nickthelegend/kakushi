// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FhishErrors} from "./FhishErrors.sol";
import {FhishSigners} from "./FhishSigners.sol";

interface IFhishInputVerifier {
    function verify(bytes32 inputHandle, address user, address contractAddress, bytes calldata proof) external view;
}

/// @title FhishInputVerifier: inputs are bound to (handle, user, contract, chain).
/// @notice When a user uploads a ciphertext, coprocessor signers check it deserializes and expands
///         under the network key (a malformed blob is refused) and sign an EIP-712 InputAttestation.
///         A contract can only use an input attested for itself and for the transaction's user, so
///         someone else's ciphertext cannot be replayed into another contract or by another sender.
///         proof = abi.encode(bytes[] signatures), threshold k-of-n.
///         TRUST (today): the input signers see ciphertexts, never plaintexts. Zama-style ZK proofs of
///         knowledge on the CompactCiphertextList are roadmap.
contract FhishInputVerifier is IFhishInputVerifier, FhishSigners {
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("InputAttestation(bytes32 handle,address user,address contractAddress)");

    constructor(address owner_, address[] memory signers_, uint256 threshold_)
        FhishSigners("FhishInputVerifier", owner_, signers_, threshold_)
    {}

    function verify(bytes32 inputHandle, address user, address contractAddress, bytes calldata proof) external view {
        bytes[] memory sigs = abi.decode(proof, (bytes[]));
        bytes32 digest = _digest(keccak256(abi.encode(ATTESTATION_TYPEHASH, inputHandle, user, contractAddress)));
        _requireThreshold(digest, sigs);
    }

    function digestFor(bytes32 inputHandle, address user, address contractAddress) external view returns (bytes32) {
        return _digest(keccak256(abi.encode(ATTESTATION_TYPEHASH, inputHandle, user, contractAddress)));
    }
}
