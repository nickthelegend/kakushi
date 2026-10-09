// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {KakushiPool} from "../../src/privacy/KakushiPool.sol";
import {PrivateCallExecutor} from "../../src/privacy/PrivateCallExecutor.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {IRootOracle} from "../../src/interfaces/IRootOracle.sol";
import {Errors} from "../../src/lib/Errors.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {ShieldedWithdrawVerifier} from "../../src/verifiers/ShieldedWithdrawVerifier.sol";
import {TestToken, ToggleVerifier} from "../utils/TestToken.sol";
import {DemoMerchant, ReentrantTarget} from "../utils/DemoMerchant.sol";

/// @notice "Any contract call -> private": KakushiPool.withdrawAndCall with REAL Noir/UltraHonk
///         proofs (packages/attest-core/scripts/pool-ffi.ts, call mode) paying an existing public
///         contract (DemoMerchant) from a shielded note.
contract PrivateCallTest is Test {
    uint256 constant P = Poseidon2.P;
    uint64 constant MONAD = 10143;
    uint64 constant SEPOLIA = 11155111;

    IVerifier verifier;
    TestToken usdc;
    KakushiPool monPool; // 1 MON
    KakushiPool usdcPool; // 100 USDC
    DemoMerchant merchant; // 0.7 MON or 60 USDC per order
    DemoMerchant otherMerchant;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address relayer = makeAddr("relayer");
    address refundTo = makeAddr("bob-refund-stealth");
    address buyer = makeAddr("bob-buyer-stealth");
    bytes32 constant ORDER = keccak256("order-42");

    event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);
    event PrivateCall(
        bytes32 indexed nullifierHash,
        address indexed target,
        address refundTo,
        uint256 amount,
        uint256 refundedToken,
        uint256 refundedNative
    );
    event Paid(bytes32 indexed orderId, address beneficiary, address payer, uint256 amount);

    function setUp() public {
        vm.chainId(MONAD);
        vm.warp(1_800_000_000);
        verifier = IVerifier(address(new ShieldedWithdrawVerifier()));
        usdc = new TestToken("USD Coin", "USDC", 6);
        monPool = new KakushiPool(verifier, address(0), 1 ether, IRootOracle(address(0)));
        usdcPool = new KakushiPool(verifier, address(usdc), 100e6, IRootOracle(address(0)));
        merchant = new DemoMerchant(0.7 ether, address(usdc), 60e6);
        otherMerchant = new DemoMerchant(0.7 ether, address(usdc), 60e6);
        for (uint256 i; i < 3; i++) {
            address who = [alice, bob, carol][i];
            vm.deal(who, 100 ether);
            usdc.mint(who, 1_000e6);
            vm.prank(who);
            usdc.approve(address(usdcPool), type(uint256).max);
        }
        vm.deal(relayer, 1 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _note(string memory label) internal pure returns (uint256 nullifier, uint256 secret, bytes32 commitment) {
        nullifier = uint256(keccak256(abi.encode(label, "nullifier"))) % P;
        secret = uint256(keccak256(abi.encode(label, "secret"))) % P;
        commitment = bytes32(Poseidon2.hash2(nullifier, secret));
    }

    function _threeDeposits(KakushiPool pool) internal returns (bytes32[] memory leaves) {
        leaves = new bytes32[](3);
        string[3] memory labels = ["alice", "bob", "carol"];
        address[3] memory who = [alice, bob, carol];
        bool native = pool.token() == address(0);
        uint256 d = pool.denomination();
        for (uint256 i; i < 3; i++) {
            (,, leaves[i]) = _note(labels[i]);
            vm.prank(who[i]);
            if (native) pool.deposit{value: d}(leaves[i]);
            else pool.deposit(leaves[i]);
        }
    }

    function _leavesJson(bytes32[] memory leaves) internal pure returns (string memory s) {
        s = "[";
        for (uint256 i; i < leaves.length; i++) {
            s = string.concat(s, i == 0 ? '"' : ',"', vm.toString(uint256(leaves[i])), '"');
        }
        s = string.concat(s, "]");
    }

    struct C {
        bytes32 root;
        bytes32 nullifierHash;
        bytes proof;
        address relayer;
        uint256 fee;
        address target;
        bytes data;
        address refundTo;
    }

    /// REAL proof that bob's note pays `target` with `data` (leftovers to refundTo), via `pool`.
    function _proveCall(KakushiPool pool, bytes32[] memory leaves, uint256 fee, address target, bytes memory data)
        internal
        returns (C memory c)
    {
        (uint256 nullifier, uint256 secret,) = _note("bob");
        string memory json = string.concat(
            '{"mode":"prove","leaves":', _leavesJson(leaves), ',"nullifier":"', vm.toString(nullifier),
            '","secret":"', vm.toString(secret), '","relayer":"', vm.toString(relayer), '","fee":"', vm.toString(fee)
        );
        json = string.concat(
            json, '","chainId":"', vm.toString(block.chainid), '","pool":"', vm.toString(address(pool)),
            '","call":{"target":"', vm.toString(target), '","data":"', vm.toString(data), '","refundTo":"',
            vm.toString(refundTo), '"}}'
        );
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../attest-core/scripts/pool-ffi.ts";
        cmd[2] = json;
        bytes32[] memory pis;
        (c.root, c.nullifierHash, c.proof, pis) = abi.decode(vm.ffi(cmd), (bytes32, bytes32, bytes, bytes32[]));
        assertGt(c.proof.length, 0, "proof generated");
        c.relayer = relayer;
        c.fee = fee;
        c.target = target;
        c.data = data;
        c.refundTo = refundTo;
        _checkPublicInputs(pool, c, pis);
    }

    /// the prover's public inputs (TS extDataHash + executor address) are exactly the pool's
    function _checkPublicInputs(KakushiPool pool, C memory c, bytes32[] memory pis) internal view {
        bytes32[] memory expected =
            pool.callPublicInputs(c.root, c.nullifierHash, c.relayer, c.fee, c.target, c.data, c.refundTo);
        assertEq(pis.length, 9, "9 public inputs");
        for (uint256 i; i < pis.length; i++) assertEq(pis[i], expected[i], "public input encoding");
        assertEq(pis[2], bytes32(uint256(uint160(address(pool.executor())))), "recipient = executor");
        assertEq(uint256(pis[5]), 0, "refund = 0");
        assertEq(uint256(pis[8]), pool.extDataHash(c.target, c.data, c.refundTo));
        bytes32 h = keccak256(abi.encode(c.target, c.data, c.refundTo, block.chainid, address(pool)));
        assertEq(uint256(pis[8]), uint256(h) % P, "extDataHash = keccak256(abi.encode(target, data, refundTo, chainid, pool)) mod p");
    }

    function _call(KakushiPool pool, C memory c) internal returns (uint256 gasUsed) {
        uint256 g = gasleft();
        pool.withdrawAndCall(c.proof, c.root, c.nullifierHash, payable(c.relayer), c.fee, c.target, c.data, c.refundTo);
        gasUsed = g - gasleft();
    }

    function _expectCallRevert(KakushiPool pool, C memory c, bytes memory err) internal {
        vm.expectRevert(err);
        pool.withdrawAndCall(c.proof, c.root, c.nullifierHash, payable(c.relayer), c.fee, c.target, c.data, c.refundTo);
    }

    function _copy(C memory c) internal pure returns (C memory d) {
        d = C(c.root, c.nullifierHash, c.proof, c.relayer, c.fee, c.target, c.data, c.refundTo);
    }

    // ------------------------------------------------------------------ real-proof tests

    /// A shielded 1 MON note pays a 0.7 MON order on an unmodified public contract; the merchant's
    /// refund of the overpayment (to msg.sender = executor) is swept to the bound refundTo.
    function test_NativePrivatePaymentWithRealProof() public {
        bytes32[] memory leaves = _threeDeposits(monPool);
        bytes memory data = abi.encodeCall(DemoMerchant.pay, (ORDER, buyer));
        C memory c = _proveCall(monPool, leaves, 0.01 ether, address(merchant), data);
        assertEq(address(monPool.executor()), vm.computeCreateAddress(address(monPool), 1), "executor = CREATE(pool, 1)");
        bytes memory invalid = abi.encodeWithSelector(Errors.InvalidProof.selector);

        // a relayer (or front-runner) cannot redirect the call, the order, the leftovers or the fee
        C memory t = _copy(c);
        t.target = address(otherMerchant);
        _expectCallRevert(monPool, t, invalid);
        t = _copy(c);
        t.data = abi.encodeCall(DemoMerchant.pay, (ORDER, makeAddr("thief")));
        _expectCallRevert(monPool, t, invalid);
        t = _copy(c);
        t.refundTo = makeAddr("thief");
        _expectCallRevert(monPool, t, invalid);
        t = _copy(c);
        t.relayer = makeAddr("other-relayer");
        _expectCallRevert(monPool, t, invalid);
        t = _copy(c);
        t.fee = 0.3 ether;
        _expectCallRevert(monPool, t, invalid);
        // the call proof is not a plain-withdraw proof (recipient = executor is refused outright)
        address payable exec0 = payable(address(monPool.executor()));
        vm.expectRevert(Errors.InvalidRecipient.selector);
        monPool.withdraw(c.proof, c.root, c.nullifierHash, exec0, payable(relayer), c.fee, 0);
        vm.expectRevert(invalid);
        monPool.withdraw(c.proof, c.root, c.nullifierHash, payable(refundTo), payable(relayer), c.fee, 0);
        // nor valid on another chain
        vm.chainId(SEPOLIA);
        _expectCallRevert(monPool, c, invalid);
        vm.chainId(MONAD);

        // the call reverting reverts the whole withdrawal: the note stays spendable
        merchant.setClosed(true);
        _expectCallRevert(monPool, c, abi.encodeWithSignature("Error(string)", "merchant closed"));
        assertFalse(monPool.isSpent(c.nullifierHash));
        merchant.setClosed(false);

        uint256 relayerBefore = relayer.balance;
        address exec = address(monPool.executor());
        vm.expectEmit(address(merchant));
        emit Paid(ORDER, buyer, exec, 0.7 ether);
        vm.expectEmit(address(monPool));
        emit Withdrawal(exec, c.nullifierHash, relayer, 0.01 ether);
        vm.expectEmit(address(monPool));
        emit PrivateCall(c.nullifierHash, address(merchant), refundTo, 0.99 ether, 0, 0.29 ether);
        uint256 gasUsed = _call(monPool, c);
        console2.log("withdrawAndCall gas (native, real proof, DemoMerchant.pay + refund)", gasUsed);

        assertEq(merchant.orderOwner(ORDER), buyer, "order credited to the beneficiary in calldata");
        assertEq(address(merchant).balance, 0.7 ether, "merchant paid");
        assertEq(refundTo.balance, 0.29 ether, "leftover swept to the bound refundTo");
        assertEq(relayer.balance, relayerBefore + 0.01 ether, "relayer fee");
        assertEq(exec.balance, 0, "executor holds nothing");
        assertEq(address(monPool).balance, 2 ether);
        assertTrue(monPool.isSpent(c.nullifierHash));
        _expectCallRevert(monPool, c, abi.encodeWithSelector(Errors.NullifierSpent.selector, c.nullifierHash));
    }

    /// A shielded 100 USDC note pays a 60 USDC order (approve + call, allowance reset to 0); the 39
    /// USDC the merchant did not pull go to refundTo.
    function test_TokenPrivatePaymentWithRealProof() public {
        bytes32[] memory leaves = _threeDeposits(usdcPool);
        bytes memory data = abi.encodeCall(DemoMerchant.payWithToken, (ORDER, buyer));
        C memory c = _proveCall(usdcPool, leaves, 1e6, address(merchant), data);

        C memory t = _copy(c);
        t.data = abi.encodeCall(DemoMerchant.payWithToken, (keccak256("order-43"), buyer));
        _expectCallRevert(usdcPool, t, abi.encodeWithSelector(Errors.InvalidProof.selector));
        t = _copy(c);
        t.target = address(otherMerchant);
        _expectCallRevert(usdcPool, t, abi.encodeWithSelector(Errors.InvalidProof.selector));
        t = _copy(c);
        t.refundTo = relayer;
        _expectCallRevert(usdcPool, t, abi.encodeWithSelector(Errors.InvalidProof.selector));

        address exec = address(usdcPool.executor());
        vm.expectEmit(address(usdcPool));
        emit PrivateCall(c.nullifierHash, address(merchant), refundTo, 99e6, 39e6, 0);
        uint256 gasUsed = _call(usdcPool, c);
        console2.log("withdrawAndCall gas (ERC-20, real proof, approve + payWithToken + reset + sweep)", gasUsed);

        assertEq(merchant.orderOwner(ORDER), buyer);
        assertEq(usdc.balanceOf(address(merchant)), 60e6, "merchant pulled its price");
        assertEq(usdc.balanceOf(refundTo), 39e6, "unpulled remainder to refundTo");
        assertEq(usdc.balanceOf(relayer), 1e6, "relayer fee in USDC");
        assertEq(usdc.balanceOf(exec), 0, "executor holds nothing");
        assertEq(usdc.allowance(exec, address(merchant)), 0, "approval reset to 0");
        assertEq(usdc.balanceOf(address(usdcPool)), 200e6);
        assertTrue(usdcPool.isSpent(c.nullifierHash));
    }

    // ------------------------------------------------------------------ rules (verifier double)

    function _togglePool(address token, uint256 denomination) internal returns (KakushiPool pool, ToggleVerifier tv) {
        tv = new ToggleVerifier();
        pool = new KakushiPool(IVerifier(address(tv)), token, denomination, IRootOracle(address(0)));
        if (token == address(0)) {
            vm.prank(alice);
            pool.deposit{value: denomination}(bytes32(uint256(7)));
        } else {
            vm.startPrank(alice);
            usdc.approve(address(pool), denomination);
            pool.deposit(bytes32(uint256(7)));
            vm.stopPrank();
        }
    }

    function test_WithdrawAndCallRules() public {
        (KakushiPool pool,) = _togglePool(address(0), 1 ether);
        bytes32 root = pool.getLastRoot();
        bytes32 nh = bytes32(uint256(1));
        address exec = address(pool.executor());
        bytes memory data = abi.encodeCall(DemoMerchant.pay, (ORDER, buyer));
        address payable rl = payable(relayer);

        vm.expectRevert(Errors.InvalidRecipient.selector);
        pool.withdrawAndCall("", root, nh, rl, 0, address(merchant), data, address(0));
        address[4] memory badTargets = [address(0), makeAddr("eoa"), address(pool), exec];
        for (uint256 i; i < badTargets.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(Errors.InvalidCallTarget.selector, badTargets[i]));
            pool.withdrawAndCall("", root, nh, rl, 0, badTargets[i], data, refundTo);
        }
        vm.expectRevert(abi.encodeWithSelector(Errors.FeeTooHigh.selector, 2 ether, 1 ether));
        pool.withdrawAndCall("", root, nh, rl, 2 ether, address(merchant), data, refundTo);
        vm.expectRevert(abi.encodeWithSelector(Errors.UnknownRoot.selector, bytes32(uint256(5))));
        pool.withdrawAndCall("", bytes32(uint256(5)), nh, rl, 0, address(merchant), data, refundTo);
        vm.expectRevert(Errors.InvalidRecipient.selector);
        pool.withdrawAndCall("", root, nh, payable(address(0)), 1, address(merchant), data, refundTo);
        // not payable: a relayer cannot slip coin into the call
        (bool ok,) = address(pool).call{value: 1}(
            abi.encodeCall(KakushiPool.withdrawAndCall, ("", root, nh, rl, 0, address(merchant), data, refundTo))
        );
        assertFalse(ok, "withdrawAndCall is not payable");
        // plain withdraw to the executor would strand funds there: refused
        vm.expectRevert(Errors.InvalidRecipient.selector);
        pool.withdraw("", root, nh, payable(exec), rl, 0, 0);

        // ERC-20 pool: the pool token itself is not a valid target (no approve/transfer games)
        (KakushiPool tp,) = _togglePool(address(usdc), 100e6);
        bytes32 tRoot = tp.getLastRoot();
        vm.expectRevert(abi.encodeWithSelector(Errors.InvalidCallTarget.selector, address(usdc)));
        tp.withdrawAndCall("", tRoot, nh, rl, 0, address(usdc), data, refundTo);

        // the call succeeds once the arguments are sane (proof check delegated to the toggle)
        pool.withdrawAndCall("", root, nh, rl, 0.1 ether, address(merchant), data, refundTo);
        assertEq(refundTo.balance, 0.2 ether);
        assertEq(address(merchant).balance, 0.7 ether);
        assertEq(exec.balance, 0);
    }

    function test_InvalidProofIsRejected() public {
        (KakushiPool pool, ToggleVerifier tv) = _togglePool(address(0), 1 ether);
        tv.set(false);
        bytes memory data = abi.encodeCall(DemoMerchant.pay, (ORDER, buyer));
        bytes32 root = pool.getLastRoot();
        vm.expectRevert(Errors.InvalidProof.selector);
        pool.withdrawAndCall("", root, bytes32(uint256(1)), payable(relayer), 0, address(merchant), data, refundTo);
    }

    function test_ExecutorIsPoolOnlyAndRefusesStrayCoin() public {
        PrivateCallExecutor exec = monPool.executor();
        assertEq(exec.pool(), address(monPool));
        vm.expectRevert(Errors.NotPool.selector);
        exec.execute(address(0), 0, address(merchant), "", refundTo);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(exec).call{value: 1}("");
        assertFalse(ok, "no native outside a call");
        assertEq(address(exec).balance, 0);
    }

    function test_RefundToRejectingCoinRevertsTheCall() public {
        (KakushiPool pool,) = _togglePool(address(0), 1 ether);
        bytes memory data = abi.encodeCall(DemoMerchant.pay, (ORDER, buyer));
        // refundTo = the (coin-rejecting) executor of another pool
        address rejecting = address(monPool.executor());
        bytes32 root = pool.getLastRoot();
        vm.expectRevert(Errors.TransferFailed.selector);
        pool.withdrawAndCall("", root, bytes32(uint256(1)), payable(relayer), 0, address(merchant), data, rejecting);
        assertFalse(pool.isSpent(bytes32(uint256(1))));
    }

    function test_PrivateCallIsReentrancySafe() public {
        (KakushiPool pool,) = _togglePool(address(0), 1 ether);
        ReentrantTarget evil = new ReentrantTarget(address(pool), address(pool.executor()));
        bytes32 root = pool.getLastRoot();
        pool.withdrawAndCall(
            "", root, bytes32(uint256(1)), payable(relayer), 0, address(evil),
            abi.encodeCall(ReentrantTarget.hit, ()), refundTo
        );
        assertTrue(evil.depositBlocked(), "re-entrant deposit blocked");
        assertTrue(evil.callBlocked(), "re-entrant withdrawAndCall blocked");
        assertTrue(evil.executeBlocked(), "executor only answers the pool");
        assertEq(pool.nextIndex(), 1);
        assertEq(address(evil).balance, 1 ether);
        assertEq(address(pool.executor()).balance, 0);
    }
}
