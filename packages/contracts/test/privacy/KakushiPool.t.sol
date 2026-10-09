// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {KakushiPool} from "../../src/privacy/KakushiPool.sol";
import {PoolZeros} from "../../src/privacy/PoolZeros.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {IRootOracle} from "../../src/interfaces/IRootOracle.sol";
import {Errors} from "../../src/lib/Errors.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {ShieldedWithdrawVerifier} from "../../src/verifiers/ShieldedWithdrawVerifier.sol";
import {TestToken, ToggleVerifier, ReentrantToken} from "../utils/TestToken.sol";

/// @notice Test-only root oracle (the real cross-chain one is a TODO, see IRootOracle).
contract TestRootOracle is IRootOracle {
    mapping(address => mapping(bytes32 => bool)) public known;

    function set(address pool, bytes32 root, bool ok) external {
        known[pool][root] = ok;
    }

    function isKnownRoot(address pool, bytes32 root) external view returns (bool) {
        return known[pool][root];
    }
}

/// @notice Test-only recipient that rejects native coin.
contract RejectsCoin {
    receive() external payable {
        revert("no coin");
    }
}

/// @notice KakushiPool with REAL Noir/UltraHonk proofs (packages/attest-core/scripts/pool-ffi.ts
///         builds the off-chain tree and proves with bb.js) verified by ShieldedWithdrawVerifier.
contract KakushiPoolTest is Test {
    uint256 constant P = Poseidon2.P;
    uint64 constant MONAD = 10143;
    uint64 constant SEPOLIA = 11155111;

    IVerifier verifier;
    TestToken usdc;
    KakushiPool monPool; // 1 MON
    KakushiPool usdcPool; // 100 USDC

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address recipient = makeAddr("fresh-recipient");
    address relayer = makeAddr("relayer");

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);

    function setUp() public {
        vm.chainId(MONAD);
        vm.warp(1_800_000_000);
        verifier = IVerifier(address(new ShieldedWithdrawVerifier()));
        usdc = new TestToken("USD Coin", "USDC", 6);
        monPool = new KakushiPool(verifier, address(0), 1 ether, IRootOracle(address(0)));
        usdcPool = new KakushiPool(verifier, address(usdc), 100e6, IRootOracle(address(0)));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(relayer, 1 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _note(string memory label) internal pure returns (uint256 nullifier, uint256 secret, bytes32 commitment) {
        nullifier = uint256(keccak256(abi.encode(label, "nullifier"))) % P;
        secret = uint256(keccak256(abi.encode(label, "secret"))) % P;
        commitment = bytes32(Poseidon2.hash2(nullifier, secret));
    }

    function _deposit(KakushiPool pool, address from, bytes32 commitment) internal returns (uint256 gasUsed) {
        vm.startPrank(from);
        uint256 g = gasleft();
        if (pool.token() == address(0)) {
            pool.deposit{value: pool.denomination()}(commitment);
        } else {
            pool.deposit(commitment);
        }
        gasUsed = g - gasleft();
        vm.stopPrank();
    }

    function _fundUsdc(address who) internal {
        usdc.mint(who, 1_000e6);
        vm.prank(who);
        usdc.approve(address(usdcPool), type(uint256).max);
    }

    /// alice, bob (the note we spend) and carol deposit; returns the leaves in order
    function _threeDeposits(KakushiPool pool) internal returns (bytes32[] memory leaves) {
        leaves = new bytes32[](3);
        (,, leaves[0]) = _note("alice");
        (,, leaves[1]) = _note("bob");
        (,, leaves[2]) = _note("carol");
        _deposit(pool, alice, leaves[0]);
        _deposit(pool, bob, leaves[1]);
        _deposit(pool, carol, leaves[2]);
    }

    function _leavesJson(bytes32[] memory leaves) internal pure returns (string memory s) {
        s = "[";
        for (uint256 i; i < leaves.length; i++) {
            s = string.concat(s, i == 0 ? '"' : ',"', vm.toString(uint256(leaves[i])), '"');
        }
        s = string.concat(s, "]");
    }

    function _ffi(string memory json) internal returns (bytes memory) {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../attest-core/scripts/pool-ffi.ts";
        cmd[2] = json;
        return vm.ffi(cmd);
    }

    struct W {
        bytes32 root;
        bytes32 nullifierHash;
        bytes proof;
        address recipient;
        address relayer;
        uint256 fee;
        uint256 refund;
    }

    /// REAL proof for `label`'s note against the off-chain tree of `leaves`, bound to this chain and `pool`.
    function _prove(KakushiPool pool, bytes32[] memory leaves, string memory label, uint256 fee, uint256 refund)
        internal
        returns (W memory w)
    {
        (uint256 nullifier, uint256 secret,) = _note(label);
        string memory json = string.concat(
            '{"mode":"prove","leaves":', _leavesJson(leaves), ',"nullifier":"', vm.toString(nullifier),
            '","secret":"', vm.toString(secret), '","recipient":"', vm.toString(recipient), '","relayer":"',
            vm.toString(relayer)
        );
        json = string.concat(
            json, '","fee":"', vm.toString(fee), '","refund":"', vm.toString(refund), '","chainId":"',
            vm.toString(block.chainid), '","pool":"', vm.toString(address(pool)), '"}'
        );
        bytes32[] memory pis;
        (w.root, w.nullifierHash, w.proof, pis) = abi.decode(_ffi(json), (bytes32, bytes32, bytes, bytes32[]));
        assertGt(w.proof.length, 0, "proof generated");
        w.recipient = recipient;
        w.relayer = relayer;
        w.fee = fee;
        w.refund = refund;
        // the prover's public inputs are exactly what the pool feeds the verifier
        bytes32[] memory expected = pool.publicInputs(w.root, w.nullifierHash, recipient, relayer, fee, refund);
        assertEq(pis.length, expected.length, "public input count");
        for (uint256 i; i < pis.length; i++) assertEq(pis[i], expected[i], "public input encoding");
        assertEq(w.nullifierHash, bytes32(Poseidon2.hash1(nullifier)), "nullifierHash = Poseidon2(nullifier)");
    }

    /// submitted by this contract (as the relayer's transaction would be); it pays `refund`
    function _withdraw(KakushiPool pool, W memory w) internal returns (uint256 gasUsed) {
        uint256 g = gasleft();
        pool.withdraw{value: w.refund}(
            w.proof, w.root, w.nullifierHash, payable(w.recipient), payable(w.relayer), w.fee, w.refund
        );
        gasUsed = g - gasleft();
    }

    function _expectWithdrawRevert(KakushiPool pool, W memory w, bytes memory err) internal {
        vm.expectRevert(err);
        pool.withdraw{value: w.refund}(
            w.proof, w.root, w.nullifierHash, payable(w.recipient), payable(w.relayer), w.fee, w.refund
        );
    }

    // ------------------------------------------------------------------ real-proof tests

    function test_NativeDepositWithdrawWithRealProof() public {
        bytes32[] memory leaves = _threeDeposits(monPool);
        assertEq(address(monPool).balance, 3 ether);

        W memory w = _prove(monPool, leaves, "bob", 0.01 ether, 0);
        assertEq(w.root, monPool.getLastRoot(), "off-chain root == on-chain root");

        uint256 relayerBefore = relayer.balance;
        vm.expectEmit(address(monPool));
        emit Withdrawal(recipient, w.nullifierHash, relayer, 0.01 ether);
        uint256 gasW = _withdraw(monPool, w);

        assertEq(recipient.balance, 0.99 ether, "recipient gets denomination - fee");
        assertEq(relayer.balance, relayerBefore + 0.01 ether, "relayer gets fee");
        assertEq(address(monPool).balance, 2 ether);
        assertTrue(monPool.isSpent(w.nullifierHash));
        console2.log("withdraw gas (native, real proof)", gasW);

        // double spend: same proof, and the nullifier is burnt for any other proof too
        _expectWithdrawRevert(monPool, w, abi.encodeWithSelector(Errors.NullifierSpent.selector, w.nullifierHash));
    }

    function test_TokenWithdrawPaysRelayerFeeAndRefund() public {
        _fundUsdc(alice);
        _fundUsdc(bob);
        _fundUsdc(carol);
        bytes32[] memory leaves = new bytes32[](3);
        (,, leaves[0]) = _note("alice");
        (,, leaves[1]) = _note("bob");
        (,, leaves[2]) = _note("carol");
        _deposit(usdcPool, alice, leaves[0]);
        uint256 gasD = _deposit(usdcPool, bob, leaves[1]);
        _deposit(usdcPool, carol, leaves[2]);
        assertEq(usdc.balanceOf(address(usdcPool)), 300e6);
        console2.log("deposit gas (ERC-20, 2nd leaf)", gasD);

        W memory w = _prove(usdcPool, leaves, "bob", 1e6, 0.002 ether);
        uint256 relayerEth = relayer.balance;
        uint256 gasW = _withdraw(usdcPool, w);
        console2.log("withdraw gas (ERC-20 + refund, real proof)", gasW);

        assertEq(usdc.balanceOf(recipient), 99e6, "recipient gets 100 - 1 USDC");
        assertEq(usdc.balanceOf(relayer), 1e6, "relayer fee in USDC");
        assertEq(recipient.balance, 0.002 ether, "refund forwarded to recipient as gas");
        assertEq(relayer.balance, relayerEth, "relayer's coin untouched (refund paid by the submitter)");
        assertEq(usdc.balanceOf(address(usdcPool)), 200e6);
        _expectWithdrawRevert(usdcPool, w, abi.encodeWithSelector(Errors.NullifierSpent.selector, w.nullifierHash));
    }

    /// One real proof; every public input it binds is tampered with in turn, then the honest call succeeds.
    function test_ProofIsBoundToRootRecipientRelayerFeeChainAndPool() public {
        bytes32[] memory leaves = _threeDeposits(monPool);
        W memory w = _prove(monPool, leaves, "bob", 0.05 ether, 0);
        bytes memory invalid = abi.encodeWithSelector(Errors.InvalidProof.selector);

        W memory t = _copy(w);
        t.recipient = makeAddr("front-runner");
        _expectWithdrawRevert(monPool, t, invalid);

        t = _copy(w);
        t.relayer = makeAddr("other-relayer");
        _expectWithdrawRevert(monPool, t, invalid);

        t = _copy(w);
        t.fee = 0.5 ether;
        _expectWithdrawRevert(monPool, t, invalid);

        t = _copy(w);
        (uint256 otherNullifier,,) = _note("alice");
        t.nullifierHash = bytes32(Poseidon2.hash1(otherNullifier));
        _expectWithdrawRevert(monPool, t, invalid);

        // a later root is also known, but the proof is for the earlier one
        (,, bytes32 dave) = _note("dave");
        _deposit(monPool, alice, dave);
        assertTrue(monPool.isKnownRoot(w.root) && monPool.isKnownRoot(monPool.getLastRoot()));
        t = _copy(w);
        t.root = monPool.getLastRoot();
        _expectWithdrawRevert(monPool, t, invalid);

        t = _copy(w);
        t.root = bytes32(uint256(123));
        _expectWithdrawRevert(monPool, t, abi.encodeWithSelector(Errors.UnknownRoot.selector, t.root));

        // same pool address, other chain (a fork / replay on another network)
        vm.chainId(SEPOLIA);
        _expectWithdrawRevert(monPool, w, invalid);
        vm.chainId(MONAD);

        // other pool, same deposits, same root
        KakushiPool twin = new KakushiPool(verifier, address(0), 1 ether, IRootOracle(address(0)));
        _deposit(twin, alice, leaves[0]);
        _deposit(twin, bob, leaves[1]);
        _deposit(twin, carol, leaves[2]);
        assertTrue(twin.isKnownRoot(w.root), "twin has the same root");
        _expectWithdrawRevert(twin, w, invalid);

        // the honest withdrawal still works
        _withdraw(monPool, w);
        assertEq(recipient.balance, 0.95 ether);
        assertEq(relayer.balance, 1.05 ether);
    }

    function _copy(W memory w) internal pure returns (W memory c) {
        c = W(w.root, w.nullifierHash, w.proof, w.recipient, w.relayer, w.fee, w.refund);
    }

    // ------------------------------------------------------------------ tree

    function test_TreeRootsMatchOffChainReference() public {
        KakushiPool pool = new KakushiPool(IVerifier(address(new ToggleVerifier())), address(0), 1 ether, IRootOracle(address(0)));
        assertEq(pool.getLastRoot(), bytes32(PoolZeros.zeros(20)), "empty root");
        uint256 n = 13;
        bytes32[] memory leaves = new bytes32[](n);
        bytes32[] memory onchain = new bytes32[](n);
        uint256 maxGas;
        uint256 minGas = type(uint256).max;
        for (uint256 i; i < n; i++) {
            leaves[i] = bytes32(uint256(keccak256(abi.encode("leaf", i))) % P);
            vm.expectEmit(address(pool));
            emit Deposit(leaves[i], uint32(i), block.timestamp);
            uint256 g = _deposit(pool, alice, leaves[i]);
            if (g > maxGas) maxGas = g;
            if (g < minGas) minGas = g;
            onchain[i] = pool.getLastRoot();
        }
        uint256[] memory ref =
            abi.decode(_ffi(string.concat('{"mode":"tree","leaves":', _leavesJson(leaves), "}")), (uint256[]));
        assertEq(ref.length, n);
        for (uint256 i; i < n; i++) {
            assertEq(uint256(onchain[i]), ref[i], "root after insert");
            assertTrue(pool.isKnownRoot(onchain[i]));
        }
        assertEq(pool.nextIndex(), n);
        console2.log("deposit gas (native) min", minGas);
        console2.log("deposit gas (native) max", maxGas);
    }

    function test_RootHistoryKeepsLast64() public {
        KakushiPool pool = new KakushiPool(IVerifier(address(new ToggleVerifier())), address(0), 1 ether, IRootOracle(address(0)));
        bytes32 empty = pool.getLastRoot();
        _deposit(pool, alice, bytes32(uint256(1)));
        bytes32 first = pool.getLastRoot();
        for (uint256 i = 2; i <= 63; i++) _deposit(pool, alice, bytes32(i));
        // 64 roots recorded after the empty one: empty root has been overwritten, first is the oldest
        assertTrue(pool.isKnownRoot(first));
        assertTrue(pool.isKnownRoot(empty));
        _deposit(pool, alice, bytes32(uint256(64)));
        assertFalse(pool.isKnownRoot(empty));
        assertTrue(pool.isKnownRoot(first));
        _deposit(pool, alice, bytes32(uint256(65)));
        assertFalse(pool.isKnownRoot(first));
        assertFalse(pool.isKnownRoot(bytes32(0)));
    }

    // ------------------------------------------------------------------ deposit / withdraw rules

    function test_DepositRules() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 0.5 ether, 1 ether));
        monPool.deposit{value: 0.5 ether}(bytes32(uint256(1)));
        vm.expectRevert(Errors.NotAFieldElement.selector);
        monPool.deposit{value: 1 ether}(bytes32(P));
        monPool.deposit{value: 1 ether}(bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(Errors.CommitmentExists.selector, bytes32(uint256(1))));
        monPool.deposit{value: 1 ether}(bytes32(uint256(1)));

        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 1 ether, 0));
        usdcPool.deposit{value: 1 ether}(bytes32(uint256(2)));
        vm.expectRevert(); // no allowance
        usdcPool.deposit(bytes32(uint256(2)));
        vm.stopPrank();

        vm.expectRevert(Errors.InvalidParams.selector);
        new KakushiPool(verifier, address(0), 0, IRootOracle(address(0)));
        vm.expectRevert(Errors.InvalidParams.selector);
        new KakushiPool(verifier, makeAddr("eoa-token"), 1, IRootOracle(address(0)));
        vm.expectRevert(Errors.ZeroAddress.selector);
        new KakushiPool(IVerifier(address(0)), address(0), 1, IRootOracle(address(0)));
    }

    function test_WithdrawRules() public {
        ToggleVerifier tv = new ToggleVerifier();
        KakushiPool pool = new KakushiPool(IVerifier(address(tv)), address(0), 1 ether, IRootOracle(address(0)));
        _deposit(pool, alice, bytes32(uint256(7)));
        bytes32 root = pool.getLastRoot();
        address payable r = payable(recipient);
        address payable rl = payable(relayer);

        vm.expectRevert(abi.encodeWithSelector(Errors.FeeTooHigh.selector, 2 ether, 1 ether));
        pool.withdraw("", root, bytes32(uint256(1)), r, rl, 2 ether, 0);
        vm.expectRevert(Errors.InvalidRecipient.selector);
        pool.withdraw("", root, bytes32(uint256(1)), payable(address(0)), rl, 0, 0);
        vm.expectRevert(Errors.InvalidRecipient.selector);
        pool.withdraw("", root, bytes32(uint256(1)), r, payable(address(0)), 1, 0);
        vm.expectRevert(Errors.NotAFieldElement.selector);
        pool.withdraw("", root, bytes32(P), r, rl, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 0, 0));
        pool.withdraw("", root, bytes32(uint256(1)), r, rl, 0, 1);
        tv.set(false);
        vm.expectRevert(Errors.InvalidProof.selector);
        pool.withdraw("", root, bytes32(uint256(1)), r, rl, 0, 0);
        tv.set(true);
        pool.withdraw("", root, bytes32(uint256(1)), r, payable(address(0)), 0, 0);
        assertEq(recipient.balance, 1 ether);

        // ERC-20 pools: msg.value must equal refund
        KakushiPool tp = new KakushiPool(IVerifier(address(tv)), address(usdc), 100e6, IRootOracle(address(0)));
        bytes32 tRoot = tp.getLastRoot();
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongValue.selector, 1, 2));
        tp.withdraw{value: 1}("", tRoot, bytes32(uint256(1)), r, rl, 0, 2);
    }

    function test_RefundGoesBackToRelayerIfRecipientRejectsCoin() public {
        ToggleVerifier tv = new ToggleVerifier();
        KakushiPool tp = new KakushiPool(IVerifier(address(tv)), address(usdc), 100e6, IRootOracle(address(0)));
        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(address(tp), 100e6);
        _deposit(tp, alice, bytes32(uint256(9)));
        RejectsCoin rc = new RejectsCoin();
        uint256 before = relayer.balance;
        bytes32 root = tp.getLastRoot();
        // anyone may submit; the refund is paid by msg.sender and falls back to `relayer`
        tp.withdraw{value: 0.1 ether}("", root, bytes32(uint256(3)), payable(address(rc)), payable(relayer), 2e6, 0.1 ether);
        assertEq(usdc.balanceOf(address(rc)), 98e6);
        assertEq(usdc.balanceOf(relayer), 2e6);
        assertEq(address(rc).balance, 0);
        assertEq(relayer.balance, before + 0.1 ether, "refund returned to relayer");
    }

    function test_RootOracleHookAcceptsAttestedRemoteRoots() public {
        TestRootOracle oracle = new TestRootOracle();
        KakushiPool pool = new KakushiPool(IVerifier(address(new ToggleVerifier())), address(0), 1 ether, oracle);
        _deposit(pool, alice, bytes32(uint256(5)));
        bytes32 remote = bytes32(uint256(0xbeef));
        vm.expectRevert(abi.encodeWithSelector(Errors.UnknownRoot.selector, remote));
        pool.withdraw("", remote, bytes32(uint256(1)), payable(recipient), payable(relayer), 0, 0);
        oracle.set(address(pool), remote, true);
        pool.withdraw("", remote, bytes32(uint256(1)), payable(recipient), payable(relayer), 0, 0);
        assertEq(recipient.balance, 1 ether);
        // the oracle is keyed by pool: another pool with the same oracle does not inherit the root
        KakushiPool other = new KakushiPool(IVerifier(address(new ToggleVerifier())), address(0), 1 ether, oracle);
        vm.expectRevert(abi.encodeWithSelector(Errors.UnknownRoot.selector, remote));
        other.withdraw("", remote, bytes32(uint256(1)), payable(recipient), payable(relayer), 0, 0);
    }

    function test_DepositIsReentrancySafe() public {
        ReentrantToken evil = new ReentrantToken();
        KakushiPool pool = new KakushiPool(verifier, address(evil), 10e6, IRootOracle(address(0)));
        evil.mint(alice, 100e6);
        vm.prank(alice);
        evil.approve(address(pool), type(uint256).max);
        evil.arm(address(pool), abi.encodeCall(KakushiPool.deposit, (bytes32(uint256(77)))));
        _deposit(pool, alice, bytes32(uint256(76)));
        assertTrue(evil.reentered());
        assertFalse(evil.reenterSucceeded(), "re-entrant deposit blocked");
        assertEq(pool.nextIndex(), 1);
    }
}
