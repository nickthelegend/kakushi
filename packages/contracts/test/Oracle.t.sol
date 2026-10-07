// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttestationOracle} from "../src/AttestationOracle.sol";
import {IReceiver, IERC165} from "../src/interfaces/IReceiver.sol";
import {Errors} from "../src/lib/Errors.sol";
import {Kinds} from "../src/lib/Kinds.sol";

contract OracleTest is Test {
    AttestationOracle oracle;
    address fwd = makeAddr("forwarder");
    address wfOwner = makeAddr("workflow-owner");

    function setUp() public {
        oracle = new AttestationOracle(fwd, wfOwner);
    }

    function _meta(address o) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), bytes10("kakushi"), o, bytes2(0));
    }

    function _one(uint64 chainId, uint8 kind, uint64 fromBlock, uint64 toBlock) internal pure returns (bytes memory) {
        AttestationOracle.Window[] memory ws = new AttestationOracle.Window[](1);
        ws[0] = AttestationOracle.Window(chainId, kind, fromBlock, toBlock, 100, 200, 42, 1);
        return abi.encode(ws);
    }

    function test_OnlyForwarderAndWorkflowOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.NotForwarder.selector, address(this)));
        oracle.onReport(_meta(wfOwner), _one(1, Kinds.WINDOW_PAYOUT, 1, 10));
        vm.prank(fwd);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidWorkflowOwner.selector, address(this)));
        oracle.onReport(_meta(address(this)), _one(1, Kinds.WINDOW_PAYOUT, 1, 10));
        vm.prank(fwd);
        oracle.onReport(_meta(wfOwner), _one(1, Kinds.WINDOW_PAYOUT, 1, 10));
        assertEq(oracle.windowCount(), 1);
    }

    /// Payout windows must be block-contiguous per chain (no silent gaps).
    function test_PayoutWindowsMustBeContiguous() public {
        vm.startPrank(fwd);
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_PAYOUT, 100, 110));
        vm.expectRevert(abi.encodeWithSelector(Errors.WindowNotContiguous.selector, uint64(7), uint64(111), uint64(113)));
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_PAYOUT, 113, 120));
        vm.expectRevert(abi.encodeWithSelector(Errors.WindowNotContiguous.selector, uint64(7), uint64(111), uint64(105)));
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_PAYOUT, 105, 120));
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_PAYOUT, 111, 120));
        // other chains are independent
        oracle.onReport(_meta(wfOwner), _one(8, Kinds.WINDOW_PAYOUT, 5, 6));
        // source windows need no contiguity
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_SOURCE, 1, 2));
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_SOURCE, 900, 901));
        vm.stopPrank();
        assertEq(oracle.lastPayoutToBlock(7), 120);
        assertEq(oracle.payoutCoveredUntil(7), 200);
        assertEq(oracle.windowCount(), 5);
    }

    function test_RejectsMalformedWindows() public {
        vm.startPrank(fwd);
        vm.expectRevert(Errors.InvalidWindow.selector);
        oracle.onReport(_meta(wfOwner), _one(7, Kinds.WINDOW_PAYOUT, 10, 9));
        vm.expectRevert(Errors.InvalidWindow.selector);
        oracle.onReport(_meta(wfOwner), _one(0, Kinds.WINDOW_PAYOUT, 1, 9));
        vm.expectRevert(Errors.InvalidWindow.selector);
        oracle.onReport(_meta(wfOwner), _one(7, 9, 1, 9));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(Errors.UnknownWindow.selector, 1));
        oracle.getWindow(1);
    }

    function test_SupportsIReceiver() public view {
        assertTrue(oracle.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(oracle.supportsInterface(type(IERC165).interfaceId));
        assertFalse(oracle.supportsInterface(0xdeadbeef));
    }
}
