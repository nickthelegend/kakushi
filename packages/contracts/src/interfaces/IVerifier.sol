// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shape of the Barretenberg UltraHonk Solidity verifiers (bb write_solidity_verifier).
interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
