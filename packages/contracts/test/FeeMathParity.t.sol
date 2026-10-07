// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../src/lib/FeeMath.sol";

/// @notice Invariant: fee math in Solidity == fee math in the circuit == TypeScript, on 1000
///         vectors produced by packages/attest-core/scripts/fee-vectors.ts (which already
///         asserted Noir == TypeScript by executing the fee_math circuit for each vector).
contract FeeMathParityTest is Test {
    function test_FeeMathParity1000() public view {
        string memory json = vm.readFile("fixtures/fee_vectors.json");
        uint256[] memory gross = vm.parseJsonUintArray(json, ".gross");
        uint256[] memory withholding = vm.parseJsonUintArray(json, ".withholding");
        uint256[] memory bps = vm.parseJsonUintArray(json, ".bps");
        uint256[] memory code = vm.parseJsonUintArray(json, ".code");
        uint256[] memory principal = vm.parseJsonUintArray(json, ".principal");
        uint256[] memory net = vm.parseJsonUintArray(json, ".net");
        assertEq(gross.length, 1000);
        for (uint256 i; i < gross.length; i++) {
            (uint16 c, uint256 p) = FeeMath.split(gross[i]);
            assertEq(c, code[i], "code");
            assertEq(p, principal[i], "principal");
            assertEq(FeeMath.net(p, withholding[i], bps[i]), net[i], "net");
        }
    }
}
