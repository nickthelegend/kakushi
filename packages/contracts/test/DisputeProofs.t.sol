// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {DisputeModule} from "../src/DisputeModule.sol";
import {MDC} from "../src/MDC.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// @notice End-to-end dispute tests with REAL Noir/UltraHonk proofs (generated through
///         packages/attest-core/scripts/ffi.ts) verified by the generated Solidity verifiers.
contract DisputeProofsTest is Base {
    bytes32 constant TX1 = keccak256("sepolia-tx-1");
    uint32 constant LOG1 = 3;
    uint256 constant GROSS = 100_009_001; // 100 USDC + code 9001
    uint256 constant EXPECTED = 99_850_050; // (100_000_000 - 50_000) - 10 bps
    uint64 srcTs;
    address other = makeAddr("other-user");
    bytes32 srcRef;

    function setUp() public override {
        super.setUp();
        _registerUsdcPair();
        _depositMargin(600_000_000);
        srcTs = uint64(block.timestamp);
        srcRef = _srcRef(SEPOLIA, TX1, LOG1);
    }

    // ------------------------------------------------------------ helpers

    function _fillCtx(DisputeModule m) internal view returns (Ctx memory) {
        return Ctx({
            srcRef: srcRef,
            srcChainId: SEPOLIA,
            obligationChainId: HUB,
            srcToken: SEPOLIA_USDC,
            payToken: address(usdc),
            recipient: sender,
            gross: GROSS,
            code: 9001,
            withholding: 50_000,
            bps: 10,
            expected: EXPECTED,
            mode: 1,
            srcTimestamp: srcTs,
            disputeModule: m
        });
    }

    function _sourceLeaves(uint256 gross) internal view returns (string memory) {
        // the disputed payment plus an unrelated one in the same attested window
        return string.concat(
            "[",
            _leaf(1, SEPOLIA, srcRef, sender, maker, SEPOLIA_USDC, gross, sender, 100, srcTs),
            ",",
            _leaf(1, SEPOLIA, _srcRef(SEPOLIA, keccak256("other"), 1), other, maker, SEPOLIA_USDC, 5_009_001, other, 99, srcTs - 2),
            "]"
        );
    }

    function _unrelatedPayout() internal view returns (string memory) {
        return _leaf(2, HUB, _srcRef(SEPOLIA, keccak256("other"), 1), maker, other, address(usdc), 4_950_000, other, 40, srcTs - 1);
    }

    function _claim(uint256 gross, uint256 srcWindowId) internal view returns (DisputeModule.Claim memory) {
        return DisputeModule.Claim({
            srcChainId: SEPOLIA,
            srcTxHash: TX1,
            logIndex: LOG1,
            maker: maker,
            sender: sender,
            recipient: sender,
            srcToken: SEPOLIA_USDC,
            gross: gross,
            srcTimestamp: srcTs,
            srcWindowId: srcWindowId
        });
    }

    function _postWindows(uint256 srcRoot, uint256[] memory roots, uint64 payoutChain)
        internal
        returns (uint256 srcWindowId, uint256[] memory ids)
    {
        srcWindowId = _postWindow(SEPOLIA, Kinds.WINDOW_SOURCE, 90, 110, srcTs - 5, srcTs + 5, srcRoot);
        ids = new uint256[](roots.length);
        uint64 from = 1;
        for (uint256 i; i < roots.length; i++) {
            // contiguous windows; the first starts before srcTs - skew, the last ends after the deadline
            uint64 fromTime = i == 0 ? srcTs - SKEW - 1 : srcTs + uint64(i) * 10;
            uint64 toTime = i + 1 == roots.length ? srcTs + FILL_WINDOW + 5 : srcTs + uint64(i + 1) * 10 - 1;
            ids[i] = _postWindow(payoutChain, Kinds.WINDOW_PAYOUT, from, from + 49, fromTime, toTime, roots[i]);
            from += 50;
        }
    }

    function _open(DisputeModule m) internal returns (bytes32 key) {
        vm.warp(srcTs + FILL_WINDOW + 1);
        vm.prank(challenger);
        key = m.openDispute{value: BOND}(SEPOLIA, TX1, LOG1, maker);
    }

    // ------------------------------------------------------------ tests

    /// Invariant: a valid absence proof slashes margin to the RECORDED sender; bond + reward to challenger.
    function test_ValidAbsenceProofSlashesToRecordedSender() public {
        string memory windows = string.concat("[[", _unrelatedPayout(), "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        assertGt(proof.length, 0, "proof generated");
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);
        bytes32 key = _open(dm);

        uint256 challengerEthBefore = challenger.balance;
        dm.proveDispute(_claim(GROSS, sw), ids, proof);

        assertEq(usdc.balanceOf(sender), GROSS, "sender gets gross back");
        assertEq(usdc.balanceOf(challenger), GROSS / 100, "challenger reward 1%");
        assertEq(challenger.balance, challengerEthBefore + BOND, "bond returned");
        assertEq(mdc.margin(maker, address(usdc)), 600_000_000 - GROSS - GROSS / 100);
        (,,, DisputeModule.Status st,,) = dm.disputes(key);
        assertEq(uint8(st), uint8(DisputeModule.Status.Slashed));
        assertTrue(dm.settled(key));
        assertEq(mdc.openDisputes(maker), 0);

        // cannot be disputed again
        vm.prank(challenger);
        vm.expectRevert();
        dm.openDispute{value: BOND}(SEPOLIA, TX1, LOG1, maker);
    }

    /// A proof for one gross cannot be reused with a tampered claim amount.
    function test_TamperedAmountFails() public {
        string memory windows = string.concat("[[", _unrelatedPayout(), "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);
        _open(dm);
        // same ident code, larger gross: on-chain public inputs change -> proof rejected
        vm.expectRevert();
        dm.proveDispute(_claim(GROSS + 10_000_000, sw), ids, proof);
        // tampered proof bytes are rejected too
        proof[100] = bytes1(uint8(proof[100]) ^ 0x01);
        vm.expectRevert();
        dm.proveDispute(_claim(GROSS, sw), ids, proof);
    }

    /// Invariant: replaying a proof against another hub/chain deployment fails (domain + chain ids are public inputs).
    function test_ProofReplayOtherChainFails() public {
        string memory windows = string.concat("[[", _unrelatedPayout(), "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);

        // a second deployment of the dispute stack on another chain id, same EBC/oracle
        vm.chainId(SEPOLIA);
        MDC mdc2 = new MDC(owner, ebc, 11_000, 2_000, 1_000, 26 hours, WITHDRAW_DELAY);
        DisputeModule dm2 = new DisputeModule(
            DisputeModule.Config(ebc, mdc2, oracle, complianceV, inclusionV, BOND, FILL_WINDOW, DISPUTE_WINDOW, SKEW, 100)
        );
        vm.prank(owner);
        mdc2.setDisputeModule(address(dm2));
        assertTrue(dm2.domain() != dm.domain());
        _open(dm2);
        vm.expectRevert();
        dm2.proveDispute(_claim(GROSS, sw), ids, proof);
    }

    /// Invariant: the Maker-proven path pays the challenger's bond to the Maker; no absence proof exists.
    function test_MakerProvenPaysBondToMaker() public {
        string memory paid = _leaf(2, HUB, srcRef, maker, sender, address(usdc), EXPECTED, sender, 55, srcTs + 3);
        string memory windows = string.concat("[[", _unrelatedPayout(), ",", paid, "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("inclusion", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        assertGt(proof.length, 0, "inclusion proof generated");
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);

        // an absence proof for a paid transfer cannot even be generated
        (,, bytes memory noProof) = _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        assertEq(noProof.length, 0, "no compliance proof for a filled transfer");

        bytes32 key = _open(dm);
        uint256 makerEth = maker.balance;
        dm.answerDispute(_claim(GROSS, sw), ids[0], proof);
        assertEq(maker.balance, makerEth + BOND, "bond to maker");
        (,,, DisputeModule.Status st,,) = dm.disputes(key);
        assertEq(uint8(st), uint8(DisputeModule.Status.MakerProven));
        assertEq(mdc.margin(maker, address(usdc)), 600_000_000, "margin untouched");
    }

    /// A payout that exists but is late (after the deadline) is non-compliant: slash via the presence branch.
    function test_LatePayoutIsSlashed() public {
        string memory late = _leaf(2, HUB, srcRef, maker, sender, address(usdc), EXPECTED, sender, 140, srcTs + FILL_WINDOW + 3);
        string memory windows = string.concat("[[", _unrelatedPayout(), "],[", late, "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        assertGt(proof.length, 0);
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);
        _open(dm);
        dm.proveDispute(_claim(GROSS, sw), ids, proof);
        assertEq(usdc.balanceOf(sender), GROSS);
    }

    /// An underpaid payout is non-compliant.
    function test_UnderpaidPayoutIsSlashed() public {
        string memory under = _leaf(2, HUB, srcRef, maker, sender, address(usdc), EXPECTED - 1, sender, 55, srcTs + 3);
        string memory windows = string.concat("[[", under, "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        assertGt(proof.length, 0);
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, HUB);
        _open(dm);
        dm.proveDispute(_claim(GROSS, sw), ids, proof);
        assertEq(usdc.balanceOf(sender), GROSS);
    }

    /// Invariant: a wrong ident code never creates a FILL obligation, only a REFUND one, enforced the same way.
    function test_BadCodeRefundModeSlashesWhenNotRefunded() public {
        uint256 gross = 100_009_999; // code 9999: not registered
        Ctx memory c = _fillCtx(dm);
        c.gross = gross;
        c.code = 9999;
        c.obligationChainId = SEPOLIA; // refunds happen on the source chain
        c.payToken = SEPOLIA_USDC;
        c.recipient = sender;
        c.withholding = 30_000; // refund fee
        c.bps = 0;
        c.expected = 100_000_000 - 30_000;
        c.mode = 2;
        string memory windows = "[[]]"; // the Maker never refunded
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) = _prove("compliance", c, _sourceLeaves(gross), windows, 0);
        assertGt(proof.length, 0);
        (uint256 sw, uint256[] memory ids) = _postWindows(srcRoot, roots, SEPOLIA);
        _open(dm);
        dm.proveDispute(_claim(gross, sw), ids, proof);
        assertEq(usdc.balanceOf(sender), gross);
    }

    /// Windows must cover [srcTime - skew, deadline] on the obligation chain.
    function test_UncoveredDeadlineRejected() public {
        string memory windows = string.concat("[[", _unrelatedPayout(), "]]");
        (uint256 srcRoot, uint256[] memory roots, bytes memory proof) =
            _prove("compliance", _fillCtx(dm), _sourceLeaves(GROSS), windows, 0);
        uint256 sw = _postWindow(SEPOLIA, Kinds.WINDOW_SOURCE, 90, 110, srcTs - 5, srcTs + 5, srcRoot);
        // payout window ends BEFORE the deadline
        uint256 pid = _postWindow(HUB, Kinds.WINDOW_PAYOUT, 1, 50, srcTs - SKEW - 1, srcTs + 5, roots[0]);
        _open(dm);
        uint256[] memory ids = new uint256[](1);
        ids[0] = pid;
        vm.expectRevert();
        dm.proveDispute(_claim(GROSS, sw), ids, proof);
    }
}
