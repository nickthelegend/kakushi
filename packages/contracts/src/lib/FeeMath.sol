// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The normative Kakushi fee math (PLAN.md §7.3). Identical formulas live in
///         packages/zk/lib (Noir) and packages/attest-core/src/fees.ts (TypeScript);
///         test/FeeMathParity.t.sol checks all three agree on 1000 vectors.
library FeeMath {
    uint256 internal constant CODE_MOD = 10_000;
    uint256 internal constant BPS = 10_000;

    /// @return code the ident code (last 4 decimal digits of `gross`)
    /// @return principal `gross` with the code stripped (a multiple of 10^4)
    function split(uint256 gross) internal pure returns (uint16 code, uint256 principal) {
        code = uint16(gross % CODE_MOD);
        principal = gross - code;
    }

    /// @notice net = (principal - withholding) - floor((principal - withholding) * bps / 10_000)
    /// @dev returns 0 when principal <= withholding (callers treat that as "no obligation").
    function net(uint256 principal, uint256 withholding, uint256 bps) internal pure returns (uint256) {
        if (principal <= withholding) return 0;
        uint256 base = principal - withholding;
        return base - (base * bps) / BPS;
    }
}
