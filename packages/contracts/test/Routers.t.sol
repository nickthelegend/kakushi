// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {PayoutRouter} from "../src/PayoutRouter.sol";
import {SourceRouter} from "../src/SourceRouter.sol";
import {Errors} from "../src/lib/Errors.sol";
import {TestToken, TestValidator} from "./utils/TestToken.sol";

contract RoutersTest is Test {
    PayoutRouter pr;
    SourceRouter sr;
    TestToken usdc;
    address admin = makeAddr("admin");
    address maker = makeAddr("maker");
    address maker2 = makeAddr("maker2");
    address user = makeAddr("user");
    bytes32 constant REF = bytes32(uint256(77));

    event Payout(bytes32 indexed srcRef, address indexed maker, address indexed recipient, address token, uint256 amount, uint8 kind);
    event PaymentEncoded(address indexed sender, address indexed maker, address token, uint256 gross, uint16 code, address recipient);

    function setUp() public {
        pr = new PayoutRouter(admin);
        sr = new SourceRouter(admin);
        usdc = new TestToken("USDC", "USDC", 6);
        usdc.mint(maker, 1_000e6);
        usdc.mint(maker2, 1_000e6);
        usdc.mint(user, 1_000e6);
        vm.prank(maker);
        usdc.approve(address(pr), type(uint256).max);
        vm.prank(maker2);
        usdc.approve(address(pr), type(uint256).max);
        vm.deal(maker, 10 ether);
        vm.deal(user, 10 ether);
        vm.prank(admin);
        sr.setCode(9001, true);
    }

    function test_FillErc20EmitsPayout() public {
        vm.expectEmit(true, true, true, true);
        emit Payout(REF, maker, user, address(usdc), 99_850_050, 2);
        vm.prank(maker);
        pr.fill(REF, user, address(usdc), 99_850_050);
        assertEq(usdc.balanceOf(user), 1_000e6 + 99_850_050);
        assertTrue(pr.done(maker, REF));
    }

    /// Invariant: one srcRef can be filled at most once per Maker; another address cannot block it.
    function test_OneFillPerSrcRefAndNoFrontRunBlock() public {
        // an attacker pays dust under the same srcRef first...
        vm.prank(maker2);
        pr.fill(REF, user, address(usdc), 1);
        // ...the real maker can still fill
        vm.prank(maker);
        pr.fill(REF, user, address(usdc), 5e6);
        // but never twice
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(Errors.AlreadyPaid.selector, maker, REF));
        pr.fill(REF, user, address(usdc), 5e6);
        // a refund shares the same guard on a chain
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(Errors.AlreadyPaid.selector, maker, REF));
        pr.refund(REF, user, address(usdc), 5e6);
    }

    function test_NativeFillAndRefund() public {
        uint256 before = user.balance;
        vm.prank(maker);
        pr.fill{value: 0.5 ether}(REF, user, address(0), 0.5 ether);
        assertEq(user.balance, before + 0.5 ether);
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 0.1 ether, 0.2 ether));
        pr.refund{value: 0.1 ether}(bytes32(uint256(78)), user, address(0), 0.2 ether);
        vm.expectEmit(true, true, true, true);
        emit Payout(bytes32(uint256(78)), maker, user, address(0), 0.2 ether, 3);
        vm.prank(maker);
        pr.refund{value: 0.2 ether}(bytes32(uint256(78)), user, address(0), 0.2 ether);
    }

    function test_ComplianceLaneOnceAndEnforced() public {
        TestValidator v = new TestValidator();
        vm.expectRevert(Errors.NotOwner.selector);
        pr.initCompliance(address(usdc), address(v), address(pr));
        vm.prank(admin);
        pr.initCompliance(address(usdc), address(v), address(pr));
        vm.prank(admin);
        vm.expectRevert(Errors.ComplianceFrozen.selector);
        pr.initCompliance(address(0), address(0), address(0));

        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(Errors.RecipientNotCompliant.selector, user));
        pr.fill(REF, user, address(usdc), 1e6);
        v.set(user, true);
        vm.prank(maker);
        pr.fill(REF, user, address(usdc), 1e6);
        // other tokens are unaffected
        vm.prank(maker);
        pr.fill{value: 1}(bytes32(uint256(5)), maker2, address(0), 1);
    }

    function test_SourceRouterForwardsAtomically() public {
        vm.startPrank(user);
        usdc.approve(address(sr), type(uint256).max);
        vm.expectEmit(true, true, true, true);
        emit PaymentEncoded(user, maker, address(usdc), 100_009_001, 9001, maker2);
        sr.pay(maker, address(usdc), 100_009_001, maker2);
        uint256 makerEthBefore = maker.balance;
        sr.pay{value: 1 ether + 9001}(maker, address(0), 1 ether + 9001, maker2);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(sr)), 0, "router holds nothing");
        assertEq(address(sr).balance, 0);
        assertEq(usdc.balanceOf(maker), 1_000e6 + 100_009_001);
        assertEq(maker.balance, makerEthBefore + 1 ether + 9001);
    }

    function test_SourceRouterRejectsUnknownCodeAndPause() public {
        vm.startPrank(user);
        usdc.approve(address(sr), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidIdentCode.selector, uint16(9999)));
        sr.pay(maker, address(usdc), 100_009_999, user);
        vm.stopPrank();
        vm.prank(admin);
        sr.setPaused(true);
        vm.prank(user);
        vm.expectRevert(Errors.Paused.selector);
        sr.pay(maker, address(usdc), 100_009_001, user);
        vm.expectRevert(Errors.NotGuardian.selector);
        sr.setPaused(false);
    }

    function test_SourceRouterTransferToMakerComesFromRouter() public {
        vm.startPrank(user);
        usdc.approve(address(sr), type(uint256).max);
        vm.recordLogs();
        sr.pay(maker, address(usdc), 100_009_001, user);
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        bool sawRouterToMaker;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == transferSig && address(uint160(uint256(logs[i].topics[2]))) == maker) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(sr), "attester ignores router->maker transfers");
                sawRouterToMaker = true;
            }
        }
        assertTrue(sawRouterToMaker);
    }
}
