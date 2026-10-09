// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {FhishExecutor} from "../src/lib/FhishExecutor.sol";
import {FhishACL} from "../src/lib/FhishACL.sol";
import {FhishInputVerifier} from "../src/lib/FhishInputVerifier.sol";
import {FhishDecryptionOracle} from "../src/oracle/FhishDecryptionOracle.sol";
import {FhishRegistry} from "../src/lib/FhishRegistry.sol";
import {FhishErrors} from "../src/lib/FhishErrors.sol";
import {FhishConfigStruct, FhishType, externalEuint64, externalEbool, euint64} from "../src/lib/FhishTypes.sol";
import {FhishAuction, FhishVote, ConfidentialWrappedToken, FhishDarkOTC} from "../src/examples/Examples.sol";
import {IERC20Like} from "../src/apps/ConfidentialERC20Wrapper.sol";

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function decimals() external pure returns (uint8) { return 6; }
    function symbol() external pure returns (string memory) { return "USDC"; }
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) { allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true; }
}

/// Plays a contract that computes on handles directly through the executor.
contract Caller {
    FhishExecutor ex;
    constructor(FhishExecutor e) { ex = e; }
    function trivial(uint256 v, uint8 t) external returns (bytes32) { return ex.trivialEncrypt(v, t); }
    function add(bytes32 a, bytes32 b) external returns (bytes32) { return ex.binary(1, a, b, false); }
    function trivialThenAdd(uint256 x, uint256 y) external returns (bytes32) {
        bytes32 a = ex.trivialEncrypt(x, 3);
        bytes32 b = ex.trivialEncrypt(y, 3);
        return ex.binary(1, a, b, false); // transient ACL from the executor makes this work
    }
}

contract FhishTest is Test {
    address constant REGISTRY = 0x2152Ed4dD179fCDe7FE0c2F35e274Ce4D7b0BaF9;
    uint256[3] inKeys = [uint256(0xA11), 0xA12, 0xA13];
    uint256[3] kmsKeys = [uint256(0xB11), 0xB12, 0xB13];
    address owner = makeAddr("owner");
    address forwarder = makeAddr("cre-forwarder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    FhishInputVerifier iv;
    FhishExecutor ex;
    FhishACL acl;
    FhishDecryptionOracle oracle;
    uint256 nonce;

    function setUp() public {
        vm.chainId(10143);
        address[] memory ins = new address[](3);
        address[] memory kms = new address[](3);
        for (uint256 i; i < 3; i++) {
            ins[i] = vm.addr(inKeys[i]);
            kms[i] = vm.addr(kmsKeys[i]);
        }
        iv = new FhishInputVerifier(owner, ins, 2);
        ex = new FhishExecutor(iv);
        acl = ex.acl();
        oracle = new FhishDecryptionOracle(acl, forwarder, owner, kms, 2);
        deployCodeTo("FhishRegistry.sol:FhishRegistry", abi.encode(owner), REGISTRY);
        vm.prank(owner);
        FhishRegistry(REGISTRY).setConfig(FhishConfigStruct(address(acl), address(ex), address(iv), address(oracle)));
    }

    // ------------------------------------------------------------------ helpers

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _input(uint8 t, address user, address app) internal returns (bytes32 handle, bytes memory proof) {
        handle = bytes32((uint256(keccak256(abi.encode("ct", ++nonce))) & ~uint256(0xff)) | t);
        bytes32 d = iv.digestFor(handle, user, app);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(inKeys[0], d);
        sigs[1] = _sign(inKeys[2], d);
        proof = abi.encode(sigs);
    }

    function _fulfill(uint256 id, uint256[] memory clear) internal {
        bytes32 d = oracle.resultDigest(id, clear);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(kmsKeys[1], d);
        sigs[1] = _sign(kmsKeys[0], d);
        oracle.fulfill(id, clear, sigs);
    }

    // ------------------------------------------------------------------ ACL + executor

    function test_ExecutorGivesCallerTransientAccessToResults() public {
        Caller c = new Caller(ex);
        bytes32 r = c.trivialThenAdd(2, 3);
        assertEq(FhishType.typeOf(r), 3);
        // the caller's access to the result is transient (EIP-1153), not persisted in storage
        assertTrue(acl.isAllowed(r, address(c)));
        assertFalse(acl.persistAllowed(r, address(c)));
    }

    function test_CannotComputeOnHandlesYouDontOwn() public {
        Caller mine = new Caller(ex);
        Caller thief = new Caller(ex);
        bytes32 a = mine.trivial(7, 3);
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.NotAllowed.selector, a, address(thief)));
        thief.add(a, a);
    }

    function test_AllowRequiresAccess() public {
        bytes32 h = bytes32(uint256(0x1203));
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.NotAllowed.selector, h, address(this)));
        acl.allow(h, alice);
    }

    function test_HandlesAreDeterministicAndTyped() public {
        Caller c = new Caller(ex);
        bytes32 a = c.trivial(5, 4);
        bytes32 b = c.trivial(5, 4);
        assertEq(a, b, "same inputs give the same handle: predictable before inclusion");
        assertEq(FhishType.typeOf(a), 4);
    }

    // ------------------------------------------------------------------ inputs

    function test_InputProofBindsUserAndContract() public {
        FhishVote v = new FhishVote("Ship it?", 1 days);
        (bytes32 h, bytes memory proof) = _input(FhishType.EBOOL, alice, address(v));
        // bob cannot replay alice's ciphertext
        vm.prank(bob);
        vm.expectRevert();
        v.vote(externalEbool.wrap(h), proof);
        // another contract cannot use it either
        FhishVote other = new FhishVote("Other", 1 days);
        vm.prank(alice);
        vm.expectRevert();
        other.vote(externalEbool.wrap(h), proof);
        vm.prank(alice);
        v.vote(externalEbool.wrap(h), proof);
        assertTrue(v.voted(alice));
    }

    function test_InputProofNeedsThreshold() public {
        bytes32 h = bytes32(uint256(0xabc03));
        bytes32 d = iv.digestFor(h, alice, address(this));
        bytes[] memory one = new bytes[](2);
        one[0] = _sign(inKeys[0], d);
        one[1] = _sign(inKeys[0], d); // duplicate signer counts once
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.ThresholdNotMet.selector, 1, 2));
        iv.verify(h, alice, address(this), abi.encode(one));
        bytes[] memory forged = new bytes[](2);
        forged[0] = _sign(0xDEAD, d);
        forged[1] = _sign(inKeys[1], d);
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.ThresholdNotMet.selector, 1, 2));
        iv.verify(h, alice, address(this), abi.encode(forged));
    }

    // ------------------------------------------------------------------ apps + oracle

    function test_SealedBidAuctionRevealsOnlyWinner() public {
        FhishAuction a = new FhishAuction("Genesis hanko #1", 1 hours);
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            (bytes32 h, bytes memory p) = _input(FhishType.EUINT64, who[i], address(a));
            vm.prank(who[i]);
            a.bid(externalEuint64.wrap(h), p);
        }
        assertEq(a.bidCount(), 3);
        vm.expectRevert(SealedBidAuctionErr.selector);
        this.closeEarly(a);
        vm.warp(block.timestamp + 1 hours);
        uint256 id = a.close();
        bytes32[] memory hs = oracle.handlesOf(id);
        assertEq(hs.length, 2);
        // the KMS decrypted highest = 900 and winner index = 1 (bob)
        uint256[] memory clear = new uint256[](2);
        clear[0] = 900;
        clear[1] = 1;
        _fulfill(id, clear);
        assertTrue(a.settled());
        assertEq(a.winner(), bob);
        assertEq(a.price(), 900);
    }

    error SealedBidAuctionErr();

    function closeEarly(FhishAuction a) external {
        try a.close() {} catch {
            revert SealedBidAuctionErr();
        }
    }

    function test_OracleRejectsTamperedOrDoubleFulfil() public {
        FhishVote v = new FhishVote("Q", 1);
        (bytes32 h, bytes memory p) = _input(FhishType.EBOOL, alice, address(v));
        vm.prank(alice);
        v.vote(externalEbool.wrap(h), p);
        vm.warp(block.timestamp + 2);
        uint256 id = v.tally();
        uint256[] memory clear = new uint256[](2);
        clear[0] = 1;
        clear[1] = 0;
        bytes32 d = oracle.resultDigest(id, clear);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(kmsKeys[0], d);
        sigs[1] = _sign(kmsKeys[1], d);
        uint256[] memory tampered = new uint256[](2);
        tampered[0] = 0;
        tampered[1] = 1;
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.ThresholdNotMet.selector, 0, 2));
        oracle.fulfill(id, tampered, sigs);
        oracle.fulfill(id, clear, sigs);
        assertTrue(v.tallied());
        assertEq(v.yes(), 1);
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.AlreadyFulfilled.selector, id));
        oracle.fulfill(id, clear, sigs);
    }

    function test_CreDeliveryStillNeedsKmsSignatures() public {
        FhishVote v = new FhishVote("Q", 1);
        vm.warp(block.timestamp + 2);
        uint256 id = v.tally();
        uint256[] memory clear = new uint256[](2);
        bytes32 d = oracle.resultDigest(id, clear);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(kmsKeys[0], d);
        sigs[1] = _sign(kmsKeys[2], d);
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.NotForwarder.selector, address(this)));
        oracle.onReport("", abi.encode(id, clear, sigs));
        vm.prank(forwarder);
        oracle.onReport("", abi.encode(id, clear, sigs));
        assertTrue(v.tallied());
    }

    function test_OnlyAllowedContractsCanRequestDecryption() public {
        bytes32[] memory hs = new bytes32[](1);
        hs[0] = bytes32(uint256(0x7703));
        vm.expectRevert(abi.encodeWithSelector(FhishErrors.NotAllowed.selector, hs[0], address(this)));
        oracle.requestDecryption(hs, bytes4(0));
    }

    function test_WrapperMakesAnyErc20Confidential() public {
        TestToken usdc = new TestToken();
        ConfidentialWrappedToken c = new ConfidentialWrappedToken(IERC20Like(address(usdc)), "Confidential USDC", "cUSDC");
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        usdc.approve(address(c), 100e6);
        c.wrap(60e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(c)), 60e6);
        assertTrue(euint64.unwrap(c.confidentialBalanceOf(alice)) != bytes32(0));
        assertEq(c.decimals(), 6);
        (bytes32 h, bytes memory p) = _input(FhishType.EUINT64, alice, address(c));
        vm.prank(alice);
        uint256 id = c.unwrap(externalEuint64.wrap(h), p);
        uint256[] memory clear = new uint256[](1);
        clear[0] = 25e6;
        _fulfill(id, clear);
        assertEq(usdc.balanceOf(alice), 40e6 + 25e6);
        // a random caller cannot fake the callback
        vm.expectRevert(abi.encodeWithSignature("OnlyOracle()"));
        c.onUnwrapDecrypted(id, clear);
    }

    function test_DarkOtcRevealsNothingOnNoMatch() public {
        FhishDarkOTC d = new FhishDarkOTC();
        (bytes32 ask, bytes memory pa) = _input(FhishType.EUINT64, alice, address(d));
        vm.prank(alice);
        uint256 id = d.post("WMON/USDC", 1000, externalEuint64.wrap(ask), pa);
        (bytes32 bid, bytes memory pb) = _input(FhishType.EUINT64, bob, address(d));
        vm.prank(bob);
        uint256 rid = d.take(id, externalEuint64.wrap(bid), pb);
        uint256[] memory clear = new uint256[](2); // crossed = 0, price = 0
        vm.recordLogs();
        _fulfill(rid, clear);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawNoMatch;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == keccak256("NoMatch(uint256,address)")) sawNoMatch = true;
        assertTrue(sawNoMatch);
        (,,, bool open) = d.orderInfo(id);
        assertTrue(open, "order stays open, its limit still secret");
    }
}
