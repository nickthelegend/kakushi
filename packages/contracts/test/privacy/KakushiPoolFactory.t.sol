// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {KakushiPool} from "../../src/privacy/KakushiPool.sol";
import {KakushiPoolFactory} from "../../src/privacy/KakushiPoolFactory.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {IRootOracle} from "../../src/interfaces/IRootOracle.sol";
import {Errors} from "../../src/lib/Errors.sol";
import {ShieldedWithdrawVerifier} from "../../src/verifiers/ShieldedWithdrawVerifier.sol";
import {TestToken, ToggleVerifier} from "../utils/TestToken.sol";

/// @notice "Any token -> private": the permissionless KakushiPoolFactory.
contract KakushiPoolFactoryTest is Test {
    IVerifier verifier;
    KakushiPoolFactory factory;
    TestToken token;
    address creator = makeAddr("anyone");

    event PoolCreated(address indexed token, uint256 indexed denomination, address pool, address indexed creator);

    function setUp() public {
        verifier = IVerifier(address(new ShieldedWithdrawVerifier()));
        factory = new KakushiPoolFactory(verifier);
        token = new TestToken("Some Token", "SOME", 18);
    }

    function test_CreatesPoolsAtTheirCreate2Address() public {
        address predicted = factory.predictPool(address(token), 5 ether);
        bytes memory init = abi.encodePacked(
            type(KakushiPool).creationCode, abi.encode(verifier, address(token), 5 ether, IRootOracle(address(0)))
        );
        assertEq(
            predicted,
            vm.computeCreate2Address(keccak256(abi.encode(address(token), 5 ether)), keccak256(init), address(factory)),
            "salt = keccak256(abi.encode(token, denomination))"
        );
        vm.expectEmit(address(factory));
        emit PoolCreated(address(token), 5 ether, predicted, creator);
        vm.prank(creator);
        uint256 g = gasleft();
        address pool = factory.createPool(address(token), 5 ether);
        console2.log("createPool gas (ERC-20, incl. executor)", g - gasleft());
        assertEq(pool, predicted);

        KakushiPool p = KakushiPool(pool);
        assertEq(address(p.verifier()), address(verifier), "shared verifier");
        assertEq(p.token(), address(token));
        assertEq(p.denomination(), 5 ether);
        assertEq(address(p.rootOracle()), address(0), "no root oracle");
        assertEq(address(p.executor()), vm.computeCreateAddress(pool, 1));
        assertEq(p.executor().pool(), pool);
        assertEq(factory.poolOf(address(token), 5 ether), pool);

        // native, and another denomination of the same token
        address native = factory.createPool(address(0), 0.5 ether);
        address token2 = factory.createPool(address(token), 7 ether);
        assertEq(KakushiPool(native).token(), address(0));
        assertTrue(native != pool && token2 != pool);
        address[] memory all = factory.allPools();
        assertEq(all.length, 3);
        assertEq(all[0], pool);
        assertEq(all[1], native);
        assertEq(all[2], token2);
        assertEq(factory.poolCount(), 3);
        assertEq(factory.poolOf(address(0), 0.5 ether), native);
        assertEq(factory.poolOf(address(0), 1 ether), address(0));
    }

    function test_RejectsDuplicatesAndInvalidParams() public {
        address pool = factory.createPool(address(token), 1e18);
        vm.expectRevert(abi.encodeWithSelector(Errors.PoolExists.selector, address(token), 1e18, pool));
        vm.prank(creator);
        factory.createPool(address(token), 1e18);

        vm.expectRevert(Errors.InvalidParams.selector);
        factory.createPool(address(token), 0);
        vm.expectRevert(Errors.InvalidParams.selector);
        factory.createPool(address(0), 0);
        vm.expectRevert(Errors.InvalidParams.selector);
        factory.createPool(makeAddr("eoa-token"), 1);
        vm.expectRevert(Errors.InvalidParams.selector); // KakushiPool caps denominations below 2^128
        factory.createPool(address(token), 2 ** 128);
        assertEq(factory.poolCount(), 1);

        vm.expectRevert(Errors.ZeroAddress.selector);
        new KakushiPoolFactory(IVerifier(address(0)));
    }

    /// A factory pool is a full KakushiPool: deposit, then withdraw (proof checking delegated to a
    /// verifier double; the real-proof paths are covered by KakushiPool.t.sol and PrivateCall.t.sol).
    function test_FactoryPoolDepositsAndWithdraws() public {
        KakushiPoolFactory f = new KakushiPoolFactory(IVerifier(address(new ToggleVerifier())));
        KakushiPool p = KakushiPool(f.createPool(address(token), 3 ether));
        address alice = makeAddr("alice");
        token.mint(alice, 3 ether);
        vm.startPrank(alice);
        token.approve(address(p), 3 ether);
        p.deposit(bytes32(uint256(42)));
        vm.stopPrank();
        address recipient = makeAddr("recipient");
        p.withdraw("", p.getLastRoot(), bytes32(uint256(1)), payable(recipient), payable(makeAddr("relayer")), 0.1 ether, 0);
        assertEq(token.balanceOf(recipient), 2.9 ether);
    }
}
