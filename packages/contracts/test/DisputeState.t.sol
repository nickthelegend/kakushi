// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {DisputeModule} from "../src/DisputeModule.sol";
import {Errors} from "../src/lib/Errors.sol";
import {Kinds} from "../src/lib/Kinds.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {ToggleVerifier} from "./utils/TestToken.sol";

/// @notice State-machine tests with a verifier double (proof correctness is covered with
///         real proofs in DisputeProofs.t.sol).
contract DisputeStateTest is Base {
    ToggleVerifier tv;
    bytes32 constant TX = keccak256("tx");
    uint64 srcTs;
    uint256 sw;
    uint256[] ids;

    function _verifiers() internal override returns (IVerifier, IVerifier) {
        tv = new ToggleVerifier();
        return (IVerifier(address(tv)), IVerifier(address(tv)));
    }

    function setUp() public override {
        super.setUp();
        _registerUsdcPair();
        _depositMargin(600_000_000);
        srcTs = uint64(block.timestamp);
        sw = _postWindow(SEPOLIA, Kinds.WINDOW_SOURCE, 1, 2, srcTs, srcTs, 1);
        ids.push(_postWindow(HUB, Kinds.WINDOW_PAYOUT, 1, 100, srcTs - SKEW, srcTs + FILL_WINDOW + 1, 2));
    }

    function _claim(uint256 gross) internal view returns (DisputeModule.Claim memory) {
        return DisputeModule.Claim(SEPOLIA, TX, 0, maker, sender, sender, SEPOLIA_USDC, gross, srcTs, sw);
    }

    function _open() internal returns (bytes32) {
        vm.prank(challenger);
        return dm.openDispute{value: BOND}(SEPOLIA, TX, 0, maker);
    }

    function test_OpenRequiresExactBondAndIsSingle() public {
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 1, BOND));
        dm.openDispute{value: 1}(SEPOLIA, TX, 0, maker);
        bytes32 key = _open();
        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(Errors.AlreadyDisputed.selector, key));
        dm.openDispute{value: BOND}(SEPOLIA, TX, 0, maker);
        assertEq(mdc.openDisputes(maker), 1);
    }

    function test_ProveBeforeDeadlineReverts() public {
        _open();
        vm.expectRevert(abi.encodeWithSelector(Errors.DeadlineNotReached.selector, srcTs + FILL_WINDOW));
        dm.proveDispute(_claim(100_009_001), ids, hex"00");
    }

    function test_NoObligationForTopUpCode() public {
        _open();
        vm.warp(srcTs + FILL_WINDOW + 1);
        vm.expectRevert(Errors.NoObligation.selector);
        dm.proveDispute(_claim(100_000_000), ids, hex"00");
    }

    function test_InvalidProofReverts() public {
        _open();
        vm.warp(srcTs + FILL_WINDOW + 1);
        tv.set(false);
        vm.expectRevert(Errors.InvalidProof.selector);
        dm.proveDispute(_claim(100_009_001), ids, hex"00");
    }

    function test_ExpireReturnsBondToMakerAndAllowsReopen() public {
        bytes32 key = _open();
        vm.expectRevert(abi.encodeWithSelector(Errors.DisputeWindowOpen.selector, key));
        dm.expire(key);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        uint256 makerEth = maker.balance;
        dm.expire(key);
        assertEq(maker.balance, makerEth + BOND);
        assertEq(mdc.openDisputes(maker), 0);
        assertFalse(dm.settled(key));
        // prove after the window closed is impossible; a fresh dispute may be opened
        vm.expectRevert(abi.encodeWithSelector(Errors.DisputeNotOpen.selector, key));
        dm.proveDispute(_claim(100_009_001), ids, hex"00");
        _open();
    }

    function test_ProveAfterWindowClosedReverts() public {
        bytes32 key = _open();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(Errors.DisputeWindowClosed.selector, key));
        dm.proveDispute(_claim(100_009_001), ids, hex"00");
    }

    function test_WindowsMustBePayoutWindowsOfTheObligationChain() public {
        _open();
        vm.warp(srcTs + FILL_WINDOW + 1);
        uint256[] memory wrong = new uint256[](1);
        wrong[0] = sw; // a source window
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongWindowKind.selector, sw));
        dm.proveDispute(_claim(100_009_001), wrong, hex"00");
        wrong[0] = _postWindow(SEPOLIA, Kinds.WINDOW_PAYOUT, 1, 100, srcTs - SKEW, srcTs + 100, 3);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongWindowChain.selector, wrong[0], HUB, SEPOLIA));
        dm.proveDispute(_claim(100_009_001), wrong, hex"00");
        uint256[] memory none = new uint256[](0);
        vm.expectRevert(Errors.TooManyWindows.selector);
        dm.proveDispute(_claim(100_009_001), none, hex"00");
    }

    /// Invariant: slash pays the claimed (proof-bound) sender, never an arbitrary address.
    function testFuzz_SlashPaysOnlyClaimSender(address victim) public {
        vm.assume(victim != address(0) && victim != address(mdc) && victim != challenger && victim.code.length == 0);
        _open();
        vm.warp(srcTs + FILL_WINDOW + 1);
        DisputeModule.Claim memory c = _claim(100_009_001);
        c.sender = victim;
        dm.proveDispute(c, ids, hex"00");
        assertEq(usdc.balanceOf(victim), 100_009_001);
        // the sender is a public input of the proof: the real verifier binds it to the attested leaf
    }

    /// Invariant: reentrancy through the bond refund is blocked.
    function test_ReentrancyThroughBondRefundBlocked() public {
        ReenteringOpener atk = new ReenteringOpener(dm);
        vm.deal(address(atk), 1 ether);
        atk.open{value: BOND}(SEPOLIA, TX, 0, maker);
        vm.warp(srcTs + FILL_WINDOW + 1);
        atk.arm(_claim(100_009_001), ids);
        dm.proveDispute(_claim(100_009_001), ids, hex"00");
        assertTrue(atk.attempted());
        assertFalse(atk.reentered(), "reentry must fail");
        assertEq(usdc.balanceOf(sender), 100_009_001, "paid once");
    }
}

contract ReenteringOpener {
    DisputeModule dm;
    DisputeModule.Claim claim;
    uint256[] ids;
    bool public attempted;
    bool public reentered;
    bool armed;

    constructor(DisputeModule d) {
        dm = d;
    }

    function open(uint64 c, bytes32 tx_, uint32 li, address m) external payable {
        dm.openDispute{value: msg.value}(c, tx_, li, m);
    }

    function arm(DisputeModule.Claim calldata c, uint256[] calldata i) external {
        claim = c;
        ids = i;
        armed = true;
    }

    receive() external payable {
        if (armed && !attempted) {
            attempted = true;
            try dm.proveDispute(claim, ids, hex"00") {
                reentered = true;
            } catch {}
        }
    }
}
