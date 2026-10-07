// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Cleanverse CVI validator (IAPassComplianceValidator). The signature follows what
///         earlier hackathon teams reported; Cleanverse docs are invite-gated (PLAN.md §5.6).
interface IComplianceValidator {
    function complianceVerify(address pool, address user) external view returns (bool);
}
