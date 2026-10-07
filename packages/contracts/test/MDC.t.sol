// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {EBC} from "../src/EBC.sol";
import {MDC} from "../src/MDC.sol";
import {Errors} from "../src/lib/Errors.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {ToggleVerifier, TestFeed, ReentrantToken} from "./utils/TestToken.sol";

contract MDCTest is Base {
    bytes32 pairId;

    function _verifiers() internal override returns (IVerifier, IVerifier) {
        return (IVerifier(address(new ToggleVerifier())), IVerifier(address(new ToggleVerifier())));
    }

    function setUp() public override {
        super.setUp();
        pairId = _registerUsdcPair();
        _depositMargin(600_000_000);
    }

    function test_RequiredIsKTimesMaxLimit() public view {
        // k = 1.1 x 500 USDC max
        assertEq(mdc.required(maker, address(usdc)), 550_000_000);
    }

    function test_WithdrawTimelockAndRequired() public {
        vm.startPrank(maker);
        mdc.requestWithdraw(address(usdc), 100_000_000);
        vm.expectRevert(abi.encodeWithSelector(Errors.WithdrawLocked.selector, uint64(block.timestamp + WITHDRAW_DELAY)));
        mdc.executeWithdraw(address(usdc));
        vm.warp(block.timestamp + WITHDRAW_DELAY);
        // 600 - 100 = 500 < 550 required
        vm.expectRevert(abi.encodeWithSelector(Errors.MarginBelowRequired.selector, 500_000_000, 550_000_000));
        mdc.executeWithdraw(address(usdc));
        mdc.requestWithdraw(address(usdc), 50_000_000);
        vm.warp(block.timestamp + WITHDRAW_DELAY);
        mdc.executeWithdraw(address(usdc));
        vm.stopPrank();
        assertEq(usdc.balanceOf(maker), 50_000_000);
        assertEq(mdc.margin(maker, address(usdc)), 550_000_000);
    }

    /// Invariant: margin cannot be withdrawn while a dispute is open.
    function test_WithdrawBlockedWithOpenDispute() public {
        vm.prank(maker);
        mdc.requestWithdraw(address(usdc), 10_000_000);
        vm.prank(challenger);
        dm.openDispute{value: BOND}(SEPOLIA, keccak256("tx"), 0, maker);
        vm.warp(block.timestamp + WITHDRAW_DELAY);
        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(Errors.OpenDisputes.selector, 1));
        mdc.executeWithdraw(address(usdc));
    }

    /// A pair deactivated recently still counts toward required margin until the withdraw delay passes.
    function test_RecentlyDeactivatedPairStillCounts() public {
        vm.prank(maker);
        ebc.setActive(pairId, false);
        assertEq(mdc.required(maker, address(usdc)), 550_000_000);
        vm.warp(block.timestamp + WITHDRAW_DELAY + 1);
        assertEq(mdc.required(maker, address(usdc)), 0);
        vm.startPrank(maker);
        mdc.requestWithdraw(address(usdc), 600_000_000);
        vm.warp(block.timestamp + WITHDRAW_DELAY);
        mdc.executeWithdraw(address(usdc));
        vm.stopPrank();
        assertEq(usdc.balanceOf(maker), 600_000_000);
    }

    function test_OnlyDisputeModuleCanSlashOrLock() public {
        vm.expectRevert(Errors.NotDisputeModule.selector);
        mdc.slash(maker, address(usdc), sender, 1, bytes32(0));
        vm.expectRevert(Errors.NotDisputeModule.selector);
        mdc.lockDispute(maker);
        vm.prank(owner);
        vm.expectRevert(Errors.AlreadyConfigured.selector);
        mdc.setDisputeModule(owner);
    }

    function test_SlashPaysAtMostAvailable() public {
        vm.prank(address(dm));
        uint256 paid = mdc.slash(maker, address(usdc), sender, 1_000_000_000, bytes32("k"));
        assertEq(paid, 600_000_000);
        assertEq(usdc.balanceOf(sender), 600_000_000);
        assertEq(mdc.margin(maker, address(usdc)), 0);
    }

    function test_PricedPairUsesChainlinkWithHaircutAndFailsSafe() public {
        TestFeed feed = new TestFeed();
        feed.set(2_500e8, block.timestamp);
        vm.prank(maker);
        ebc.registerPair(
            EBC.Pair(maker, SEPOLIA, address(0), BASE_SEPOLIA, address(0), CODE_BASE),
            EBC.Params(0, 0.0001 ether, 30, 0.001 ether, 0.05 ether),
            EBC.MarginConfig(address(usdc), address(feed), 18, true)
        );
        // 0.05 ETH x 2500 = 125 USDC, x1.2 haircut = 150, x1.1 k = 165 (USDC pair needs 550: max wins)
        assertEq(mdc.required(maker, address(usdc)), 550_000_000);
        // compensation for 0.01 ETH at 2500 = 25 USDC x 1.1 premium = 27.5 USDC
        assertEq(mdc.compensation(0.01 ether, address(usdc), address(feed), 18), 27_500_000);

        // stale price: withdrawals block (fail safe), compensation still computes (never blocks a victim)
        vm.warp(block.timestamp + 27 hours);
        vm.expectRevert(abi.encodeWithSelector(Errors.StalePrice.selector, feed.updatedAt()));
        mdc.required(maker, address(usdc));
        assertEq(mdc.compensation(0.01 ether, address(usdc), address(feed), 18), 27_500_000);
        feed.set(0, block.timestamp);
        vm.expectRevert(Errors.BadPrice.selector);
        mdc.compensation(0.01 ether, address(usdc), address(feed), 18);
    }

    /// Invariant: reentrancy on withdraw is blocked (a maker contract re-enters from a token hook).
    function test_ReentrancyOnWithdrawBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        MakerAttacker atk = new MakerAttacker(mdc, ebc, evil, HUB, CODE_MONAD);
        evil.mint(address(atk), 1_000);
        atk.setup();
        vm.warp(block.timestamp + WITHDRAW_DELAY);
        evil.arm(address(atk), abi.encodeCall(MakerAttacker.reenter, ()));
        atk.withdraw();
        assertTrue(evil.reentered());
        assertFalse(evil.reenterSucceeded(), "reentry must fail");
        assertEq(evil.balanceOf(address(atk)), 500, "withdrawn exactly once");
        assertEq(mdc.margin(address(atk), address(evil)), 500);
    }
}

contract MakerAttacker {
    MDC mdc;
    EBC ebc;
    ReentrantToken token;
    uint64 hub;
    uint16 code;

    constructor(MDC m, EBC e, ReentrantToken t, uint64 h, uint16 c) {
        mdc = m;
        ebc = e;
        token = t;
        hub = h;
        code = c;
    }

    function setup() external {
        ebc.registerPair(
            EBC.Pair(address(this), 84532, address(token), hub, address(token), code),
            EBC.Params(0, 1, 1, 10, 100),
            EBC.MarginConfig(address(token), address(0), 6, true)
        );
        token.approve(address(mdc), 1_000);
        mdc.depositMargin(address(token), 1_000);
        mdc.requestWithdraw(address(token), 500);
    }

    function withdraw() external {
        mdc.executeWithdraw(address(token));
    }

    function reenter() external {
        mdc.executeWithdraw(address(token));
    }
}
