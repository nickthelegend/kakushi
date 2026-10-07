// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {MDC} from "../../src/MDC.sol";
import {DisputeModule} from "../../src/DisputeModule.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {TestToken, ToggleVerifier} from "../utils/TestToken.sol";

/// @notice Random sequences of deposits, withdraw requests/executions, dispute opens/expiries.
contract MarginHandler is Test {
    MDC mdc;
    DisputeModule dm;
    TestToken usdc;
    address maker;
    address challenger;
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public withdrawnWhileDisputeOpen;
    bytes32[] public keys;
    uint256 nonce;

    constructor(MDC m, DisputeModule d, TestToken u, address mk, address ch) {
        mdc = m;
        dm = d;
        usdc = u;
        maker = mk;
        challenger = ch;
    }

    function deposit(uint256 amt) external {
        amt = bound(amt, 1, 1_000_000_000);
        usdc.mint(maker, amt);
        vm.startPrank(maker);
        usdc.approve(address(mdc), amt);
        mdc.depositMargin(address(usdc), amt);
        vm.stopPrank();
        ghostDeposited += amt;
    }

    function requestWithdraw(uint256 amt) external {
        uint256 bal = mdc.margin(maker, address(usdc));
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(maker);
        mdc.requestWithdraw(address(usdc), amt);
    }

    function executeWithdraw() external {
        uint256 open = mdc.openDisputes(maker);
        uint256 before = usdc.balanceOf(maker);
        vm.prank(maker);
        try mdc.executeWithdraw(address(usdc)) {
            uint256 got = usdc.balanceOf(maker) - before;
            ghostWithdrawn += got;
            if (open != 0) withdrawnWhileDisputeOpen += 1;
        } catch {}
    }

    function openDispute() external {
        vm.deal(challenger, 1 ether);
        vm.prank(challenger);
        try dm.openDispute{value: 0.05 ether}(11155111, keccak256(abi.encode(nonce++)), 0, maker) returns (bytes32 k) {
            keys.push(k);
        } catch {}
    }

    function expire(uint256 i) external {
        if (keys.length == 0) return;
        bytes32 k = keys[i % keys.length];
        try dm.expire(k) {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 400));
    }
}

contract MarginInvariantTest is Base {
    MarginHandler h;

    function _verifiers() internal override returns (IVerifier, IVerifier) {
        return (IVerifier(address(new ToggleVerifier())), IVerifier(address(new ToggleVerifier())));
    }

    function setUp() public override {
        super.setUp();
        _registerUsdcPair();
        h = new MarginHandler(mdc, dm, usdc, maker, challenger);
        targetContract(address(h));
    }

    /// MDC holds exactly the sum of margins (no value created or lost).
    function invariant_MarginAccounting() public view {
        assertEq(usdc.balanceOf(address(mdc)), mdc.margin(maker, address(usdc)));
        assertEq(h.ghostDeposited() - h.ghostWithdrawn(), mdc.margin(maker, address(usdc)));
    }

    /// Margin never leaves while a dispute is open.
    function invariant_NoWithdrawWithOpenDispute() public view {
        assertEq(h.withdrawnWhileDisputeOpen(), 0);
    }

    /// After any withdrawal the remaining margin is >= required (or the pair has aged out).
    function invariant_MarginNeverBelowRequiredAfterWithdraw() public view {
        if (h.ghostWithdrawn() > 0) {
            assertGe(mdc.margin(maker, address(usdc)), mdc.required(maker, address(usdc)));
        }
    }
}
