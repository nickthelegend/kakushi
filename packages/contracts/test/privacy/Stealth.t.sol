// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StealthRegistry} from "../../src/privacy/StealthRegistry.sol";
import {StealthAnnouncer} from "../../src/privacy/StealthAnnouncer.sol";
import {StealthPay} from "../../src/privacy/StealthPay.sol";
import {IERC6538Registry} from "../../src/interfaces/IERC6538Registry.sol";
import {IERC5564Announcer} from "../../src/interfaces/IERC5564Announcer.sol";
import {Errors} from "../../src/lib/Errors.sol";
import {TestToken, ReentrantToken} from "../utils/TestToken.sol";

/// @notice Test-only EIP-1271 smart wallet that approves exactly one digest.
contract TestWallet {
    bytes32 public approved;

    function approve(bytes32 h) external {
        approved = h;
    }

    function isValidSignature(bytes32 h, bytes memory) external view returns (bytes4) {
        return h == approved ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract StealthTest is Test {
    StealthRegistry registry;
    StealthAnnouncer announcer;
    StealthPay pay;
    TestToken usdc;

    uint256 alicePk = 0xA11CE;
    address alice;
    address sender = makeAddr("sender");
    address stealth = makeAddr("stealth-address");
    // 66-byte scheme-1 meta-address: compressed spending key || compressed viewing key
    bytes meta = abi.encodePacked(hex"02", bytes32(uint256(1)), hex"03", bytes32(uint256(2)));
    bytes eph = abi.encodePacked(hex"02", keccak256("ephemeral"));

    event StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress);
    event NonceIncremented(address indexed registrant, uint256 newNonce);
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function setUp() public {
        alice = vm.addr(alicePk);
        registry = new StealthRegistry();
        announcer = new StealthAnnouncer();
        pay = new StealthPay(announcer);
        usdc = new TestToken("USD Coin", "USDC", 6);
        vm.deal(sender, 10 ether);
    }

    // ------------------------------------------------------------------ ERC-6538 registry

    function test_RegisterKeys() public {
        vm.expectEmit(address(registry));
        emit StealthMetaAddressSet(alice, 1, meta);
        vm.prank(alice);
        registry.registerKeys(1, meta);
        assertEq(registry.stealthMetaAddressOf(alice, 1), meta);
        assertEq(registry.stealthMetaAddressOf(alice, 2).length, 0);
    }

    function _digest(uint256 schemeId, bytes memory m, uint256 nonce) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC6538Registry"),
                keccak256("1.0"),
                block.chainid,
                address(registry)
            )
        );
        assertEq(registry.DOMAIN_SEPARATOR(), domain);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)"),
                schemeId,
                keccak256(m),
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_RegisterKeysOnBehalfWithEip712Signature() public {
        bytes memory sig = _sign(alicePk, _digest(1, meta, 0));
        vm.expectEmit(address(registry));
        emit StealthMetaAddressSet(alice, 1, meta);
        registry.registerKeysOnBehalf(alice, 1, sig, meta); // submitted by anyone
        assertEq(registry.stealthMetaAddressOf(alice, 1), meta);
        assertEq(registry.nonceOf(alice), 1);

        // replay fails (nonce moved on)
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, sig, meta);
    }

    function test_RegisterOnBehalfRejectsBadSignatures() public {
        // signed by someone else
        bytes memory wrong = _sign(0xB0B, _digest(1, meta, 0));
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, wrong, meta);

        // signature over another meta-address / scheme
        bytes memory other = _sign(alicePk, _digest(2, meta, 0));
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, other, meta);

        // malleated high-s twin of a valid signature
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, _digest(1, meta, 0));
        uint256 n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory high = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, high, meta);

        // bad length
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, hex"1234", meta);
    }

    function test_IncrementNonceInvalidatesSignature() public {
        bytes memory sig = _sign(alicePk, _digest(1, meta, 0));
        vm.expectEmit(address(registry));
        emit NonceIncremented(alice, 1);
        vm.prank(alice);
        registry.incrementNonce();
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, sig, meta);
    }

    function test_RegisterOnBehalfOfEip1271Wallet() public {
        TestWallet w = new TestWallet();
        bytes32 d = _digest(1, meta, 0);
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(address(w), 1, hex"", meta);
        w.approve(d);
        registry.registerKeysOnBehalf(address(w), 1, hex"", meta);
        assertEq(registry.stealthMetaAddressOf(address(w), 1), meta);
    }

    function test_DomainSeparatorFollowsChainId() public {
        bytes32 a = registry.DOMAIN_SEPARATOR();
        vm.chainId(11155111);
        bytes32 b = registry.DOMAIN_SEPARATOR();
        assertTrue(a != b);
        // a signature for the other chain is rejected here
        bytes memory sig = _sign(alicePk, _digest(1, meta, 0));
        vm.chainId(31337);
        vm.expectRevert(IERC6538Registry.ERC6538Registry__InvalidSignature.selector);
        registry.registerKeysOnBehalf(alice, 1, sig, meta);
    }

    // ------------------------------------------------------------------ ERC-5564 announcer

    function test_AnnounceEmitsCaller() public {
        bytes memory md = hex"ab";
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, sender, eph, md);
        vm.prank(sender);
        announcer.announce(1, stealth, eph, md);
    }

    // ------------------------------------------------------------------ StealthPay

    function test_SendNative() public {
        bytes memory md = abi.encodePacked(bytes1(0x5a), bytes4(0xeeeeeeee), pay.NATIVE_TOKEN(), uint256(0.3 ether));
        assertEq(md.length, 57);
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(pay), eph, md);
        vm.prank(sender);
        pay.sendNative{value: 0.3 ether}(1, stealth, eph, 0x5a);
        assertEq(stealth.balance, 0.3 ether);
        assertEq(address(pay).balance, 0);
    }

    function test_SendTokenWithGasTopUp() public {
        usdc.mint(sender, 50e6);
        vm.prank(sender);
        usdc.approve(address(pay), 50e6);
        bytes memory md = abi.encodePacked(bytes1(0x07), bytes4(0x23b872dd), address(usdc), uint256(50e6));
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(pay), eph, md);
        vm.prank(sender);
        pay.sendToken{value: 0.01 ether}(1, stealth, address(usdc), 50e6, eph, 0x07);
        assertEq(usdc.balanceOf(stealth), 50e6);
        assertEq(usdc.balanceOf(address(pay)), 0);
        assertEq(stealth.balance, 0.01 ether, "gas top-up forwarded");
    }

    function test_SendRejectsBadInput() public {
        vm.startPrank(sender);
        vm.expectRevert(Errors.InvalidStealthAddress.selector);
        pay.sendNative{value: 1}(1, address(0), eph, 0x00);
        vm.expectRevert(Errors.ZeroAmount.selector);
        pay.sendNative(1, stealth, eph, 0x00);
        vm.expectRevert(Errors.InvalidEphemeralPubKey.selector);
        pay.sendNative{value: 1}(1, stealth, hex"04", 0x00);
        bytes memory badPrefix = abi.encodePacked(hex"04", bytes32(uint256(1)));
        vm.expectRevert(Errors.InvalidEphemeralPubKey.selector);
        pay.sendNative{value: 1}(1, stealth, badPrefix, 0x00);
        vm.expectRevert(Errors.InvalidEphemeralPubKey.selector);
        pay.sendNative{value: 1}(2, stealth, hex"", 0x00);
        pay.sendNative{value: 1}(2, stealth, hex"01", 0x00); // other schemes: any non-empty key
        vm.expectRevert(Errors.ZeroAmount.selector);
        pay.sendToken(1, stealth, address(usdc), 0, eph, 0x00);
        vm.expectRevert(Errors.TransferFailed.selector); // no allowance
        pay.sendToken(1, stealth, address(usdc), 1, eph, 0x00);
        vm.stopPrank();
        vm.expectRevert(Errors.ZeroAddress.selector);
        new StealthPay(IERC5564Announcer(address(0)));
    }

    function test_SendTokenIsReentrancySafe() public {
        ReentrantToken evil = new ReentrantToken();
        evil.mint(sender, 10e6);
        vm.prank(sender);
        evil.approve(address(pay), type(uint256).max);
        // during the transfer the token tries to re-enter StealthPay
        evil.arm(address(pay), abi.encodeCall(StealthPay.sendToken, (1, stealth, address(evil), 1, eph, bytes1(0))));
        vm.prank(sender);
        pay.sendToken(1, stealth, address(evil), 5e6, eph, 0x01);
        assertTrue(evil.reentered());
        assertFalse(evil.reenterSucceeded(), "re-entrant send blocked");
        assertEq(evil.balanceOf(stealth), 5e6);
    }
}
