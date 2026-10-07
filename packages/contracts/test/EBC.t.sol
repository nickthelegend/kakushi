// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {EBC} from "../src/EBC.sol";
import {Errors} from "../src/lib/Errors.sol";
import {Kinds} from "../src/lib/Kinds.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {ToggleVerifier} from "./utils/TestToken.sol";

contract EBCTest is Base {
    bytes32 pairId;

    function _verifiers() internal override returns (IVerifier, IVerifier) {
        return (IVerifier(address(new ToggleVerifier())), IVerifier(address(new ToggleVerifier())));
    }

    function setUp() public override {
        super.setUp();
        pairId = _registerUsdcPair();
    }

    function test_IdentCodeRegistryIsAppendOnly() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Errors.IdentCodeTaken.selector, CODE_MONAD));
        ebc.registerIdentCode(CODE_MONAD, SEPOLIA);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidIdentCode.selector, uint16(0)));
        ebc.registerIdentCode(0, SEPOLIA);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidIdentCode.selector, uint16(10_000)));
        ebc.registerIdentCode(10_000, SEPOLIA);
        vm.stopPrank();
        vm.expectRevert(Errors.NotOwner.selector);
        ebc.registerIdentCode(1234, SEPOLIA);
    }

    function test_RegisterPairChecks() public {
        // only the maker itself
        vm.expectRevert(Errors.NotMaker.selector);
        ebc.registerPair(
            EBC.Pair(maker, SEPOLIA, address(1), HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 1, 1, 10, 100),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        vm.startPrank(maker);
        // code must point at the declared destination chain
        vm.expectRevert(abi.encodeWithSelector(Errors.IdentCodeChainMismatch.selector, CODE_SEPOLIA, SEPOLIA, HUB));
        ebc.registerPair(
            EBC.Pair(maker, BASE_SEPOLIA, address(1), HUB, address(usdc), CODE_SEPOLIA),
            EBC.Params(0, 1, 1, 10, 100),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        // withholding must be below min, fee <= 10%
        vm.expectRevert(Errors.InvalidParams.selector);
        ebc.registerPair(
            EBC.Pair(maker, BASE_SEPOLIA, address(1), HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 10, 1, 10, 100),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        vm.expectRevert(Errors.InvalidParams.selector);
        ebc.registerPair(
            EBC.Pair(maker, BASE_SEPOLIA, address(1), HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 1, 1001, 10, 100),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        // duplicate
        vm.expectRevert(abi.encodeWithSelector(Errors.PairExists.selector, pairId));
        ebc.registerPair(
            EBC.Pair(maker, SEPOLIA, SEPOLIA_USDC, HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 50_000, 10, 1_000_000, 500_000_000),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        vm.stopPrank();
        assertTrue(ebc.isMaker(maker));
        assertEq(ebc.allMakers().length, 1);
    }

    function test_ClassifyWorkedExample() public view {
        EBC.Classification memory c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, uint64(block.timestamp));
        assertEq(c.kind, Kinds.FILL);
        assertEq(c.expected, 99_850_050);
        assertEq(c.obligationChainId, HUB);
        assertEq(c.payToken, address(usdc));
        assertEq(c.code, 9001);
        (uint16 code, uint256 principal, uint256 netAmount) = ebc.quote(100_009_001, 50_000, 10);
        assertEq(code, 9001);
        assertEq(principal, 100_000_000);
        assertEq(netAmount, 99_850_050);
    }

    function test_ClassifyRefundAndNone() public view {
        uint64 t = uint64(block.timestamp);
        // unknown code -> refund of principal - refundFee
        EBC.Classification memory c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_999, t);
        assertEq(c.kind, Kinds.REFUND);
        assertEq(c.expected, 100_000_000 - 30_000);
        assertEq(c.obligationChainId, SEPOLIA);
        assertEq(c.payToken, SEPOLIA_USDC);
        // above max -> refund
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 600_000_000 + 9001, t);
        assertEq(c.kind, Kinds.REFUND);
        // below min -> refund (if above the refund fee)
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 500_000 + 9001, t);
        assertEq(c.kind, Kinds.REFUND);
        // code 0000 is the inventory top-up code -> no obligation
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_000_000, t);
        assertEq(c.kind, Kinds.NONE);
        // dust below the refund fee -> no obligation
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 20_000 + 9999, t);
        assertEq(c.kind, Kinds.NONE);
        // a token the maker does not trade -> no obligation
        c = ebc.classify(maker, SEPOLIA, address(0xdead), 100_009_001, t);
        assertEq(c.kind, Kinds.NONE);
        // a stranger is not a maker
        c = ebc.classify(sender, SEPOLIA, SEPOLIA_USDC, 100_009_001, t);
        assertEq(c.kind, Kinds.NONE);
    }

    function test_ParamUpdatesAreDelayedAndHistorical() public {
        uint64 t0 = uint64(block.timestamp);
        vm.prank(maker);
        ebc.updateParams(pairId, EBC.Params(0, 100_000, 50, 1_000_000, 500_000_000));
        // still old params until the delay passes
        EBC.Classification memory c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, uint64(block.timestamp));
        assertEq(c.expected, 99_850_050);
        vm.warp(block.timestamp + PARAM_DELAY);
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, uint64(block.timestamp));
        assertEq(c.withholding, 100_000);
        assertEq(c.expected, 99_900_000 - (99_900_000 * 50) / 10_000);
        // a payment made at t0 is still judged with the t0 params
        c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, t0);
        assertEq(c.expected, 99_850_050);
    }

    function test_DeactivationTurnsNewPaymentsIntoRefunds() public {
        uint64 before = uint64(block.timestamp);
        vm.warp(block.timestamp + 5);
        vm.prank(maker);
        ebc.setActive(pairId, false);
        assertEq(ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, uint64(block.timestamp)).kind, Kinds.REFUND);
        assertEq(ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, before).kind, Kinds.FILL);
        vm.expectRevert(Errors.NotMaker.selector);
        ebc.setActive(pairId, true);
    }

    function test_GuardianPausesOnlyNewRegistrations() public {
        vm.prank(guardian);
        ebc.setRegistrationsPaused(true);
        vm.prank(maker);
        vm.expectRevert(Errors.Paused.selector);
        ebc.registerPair(
            EBC.Pair(maker, BASE_SEPOLIA, address(0), HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 1, 1, 10, 100),
            EBC.MarginConfig(address(usdc), address(0), 18, true)
        );
        // existing pairs unaffected
        assertEq(ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, 100_009_001, uint64(block.timestamp)).kind, Kinds.FILL);
        vm.expectRevert(Errors.NotGuardian.selector);
        ebc.setRegistrationsPaused(false);
    }

    function test_MarginConfigMustBeConsistentPerToken() public {
        vm.prank(maker);
        vm.expectRevert(Errors.MarginConfigMismatch.selector);
        ebc.registerPair(
            EBC.Pair(maker, SEPOLIA, SEPOLIA_USDC, BASE_SEPOLIA, address(2), CODE_BASE),
            EBC.Params(0, 50_000, 10, 1_000_000, 500_000_000),
            EBC.MarginConfig(address(usdc), address(0), 18, true)
        );
    }

    function test_RefundFeeChangesAreDelayed() public {
        vm.prank(maker);
        ebc.setRefundFee(SEPOLIA, SEPOLIA_USDC, 90_000);
        assertEq(ebc.refundFeeAt(maker, SEPOLIA, SEPOLIA_USDC, uint64(block.timestamp)), 30_000);
        assertEq(ebc.refundFeeAt(maker, SEPOLIA, SEPOLIA_USDC, uint64(block.timestamp + PARAM_DELAY)), 90_000);
        vm.prank(sender);
        vm.expectRevert(Errors.NotMaker.selector);
        ebc.setRefundFee(SEPOLIA, SEPOLIA_USDC, 1);
    }

    function testFuzz_ClassifyMatchesFeeMath(uint128 principalUnits, uint16 code) public view {
        uint256 principal = uint256(principalUnits) * 10_000;
        code = uint16(bound(code, 1, 9999));
        uint256 gross = principal + code;
        EBC.Classification memory c = ebc.classify(maker, SEPOLIA, SEPOLIA_USDC, gross, uint64(block.timestamp));
        if (code == CODE_MONAD && principal >= 1_000_000 && principal <= 500_000_000) {
            assertEq(c.kind, Kinds.FILL);
            uint256 base = principal - 50_000;
            assertEq(c.expected, base - (base * 10) / 10_000);
        } else if (principal > 30_000) {
            assertEq(c.kind, Kinds.REFUND);
            assertEq(c.expected, principal - 30_000);
        } else {
            assertEq(c.kind, Kinds.NONE);
        }
    }
}
