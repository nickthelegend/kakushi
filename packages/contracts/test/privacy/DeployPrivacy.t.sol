// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployPrivacy} from "../../script/DeployPrivacy.s.sol";
import {KakushiPool} from "../../src/privacy/KakushiPool.sol";
import {KakushiPoolFactory} from "../../src/privacy/KakushiPoolFactory.sol";
import {StealthPay} from "../../src/privacy/StealthPay.sol";
import {TestToken} from "../utils/TestToken.sol";

/// @notice Test-only stand-in for CreateX's deployCreate2 / computeCreate2Address with a
///         deployer-guarded salt (guardedSalt = keccak256(bytes32(msg.sender) ++ salt)).
contract TestCreateX {
    function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address a) {
        bytes32 g = keccak256(abi.encode(bytes32(uint256(uint160(msg.sender))), salt));
        assembly {
            a := create2(callvalue(), add(initCode, 0x20), mload(initCode), g)
        }
        require(a != address(0), "create2 failed");
    }

    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))));
    }
}

contract DeployPrivacyTest is Test {
    address constant CREATEX = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;
    string constant DIR = "deployments/.privacy-test";
    DeployPrivacy script;

    function setUp() public {
        script = new DeployPrivacy();
    }

    // explicit config instead of env vars: env is process-global and DeployGuardTest mutates it
    function _cfg(string memory network, address verifier) internal pure returns (DeployPrivacy.Config memory) {
        return DeployPrivacy.Config({deployerPk: 1, network: network, dir: DIR, verifier: verifier});
    }

    function _clean() internal {
        if (vm.exists(DIR)) vm.removeDir(DIR, true);
    }

    function test_RejectsUnsupportedChainAndNetwork() public {
        vm.chainId(1);
        vm.expectRevert("unsupported Kakushi chain");
        script.deploy(_cfg("local", address(0)));
        vm.chainId(10143);
        vm.expectRevert("invalid Kakushi network");
        script.deploy(_cfg("mainnet", address(0)));
        vm.expectRevert("CreateX unavailable");
        script.deploy(_cfg("local", address(0)));
    }

    function test_PoolSpecsPerChain() public view {
        DeployPrivacy.PoolSpec[] memory m = script.poolSpecs(10143);
        assertEq(m[0].denomination, 1 ether);
        assertEq(m[1].denomination, 10 ether);
        assertEq(m[0].token, address(0));
        assertEq(m[2].token, 0x534b2f3A21130d7a60830c2Df862319e593943A3);
        assertEq(m[2].denomination, 10e6);
        assertEq(m[3].denomination, 100e6);
        uint64[4] memory spokes = [uint64(11155111), 84532, 421614, 11155420];
        for (uint256 i; i < spokes.length; i++) {
            DeployPrivacy.PoolSpec[] memory s = script.poolSpecs(spokes[i]);
            assertEq(s[0].denomination, 0.01 ether);
            assertEq(s[1].denomination, 0.1 ether);
            assertEq(s[1].symbol, "ETH");
            assertTrue(s[2].token != address(0));
            assertEq(s[3].denomination, 100e6);
        }
    }

    /// Hub and a spoke: stealth contracts land on the same addresses, pools are configured as
    /// specified, and the `privacy` object is merged into the existing deployment record.
    function test_DeploysSameStealthAddressesAndMergesJson() public {
        _clean();
        vm.etch(CREATEX, address(new TestCreateX()).code);
        address[2] memory stealthPay;
        address[2] memory factories;
        uint64[2] memory chains = [uint64(10143), 11155111];
        for (uint256 c; c < 2; c++) {
            vm.chainId(chains[c]);
            DeployPrivacy.PoolSpec[] memory specs = script.poolSpecs(chains[c]);
            vm.etch(specs[2].token, address(new TestToken("USD Coin", "USDC", 6)).code);
            string memory path = string.concat(DIR, "/local/", vm.toString(uint256(chains[c])), ".json");
            vm.createDir(string.concat(DIR, "/local"), true);
            vm.writeFile(path, string.concat('{"chainId":', vm.toString(uint256(chains[c])), ',"payoutRouter":"0x00000000000000000000000000000000000000aa"}'));

            script.deploy(_cfg("local", address(0)));
            string memory json = vm.readFile(path);
            assertEq(vm.parseJsonUint(json, ".chainId"), chains[c], "existing keys kept");
            assertEq(vm.parseJsonAddress(json, ".payoutRouter"), address(0xaa));
            stealthPay[c] = vm.parseJsonAddress(json, ".privacy.stealthPay");
            assertGt(stealthPay[c].code.length, 0);
            assertEq(address(StealthPay(stealthPay[c]).announcer()), vm.parseJsonAddress(json, ".privacy.stealthAnnouncer"));
            KakushiPoolFactory factory = KakushiPoolFactory(vm.parseJsonAddress(json, ".privacy.poolFactory"));
            assertGt(address(factory).code.length, 0, "factory deployed");
            assertEq(address(factory.verifier()), vm.parseJsonAddress(json, ".privacy.shieldedVerifier"));
            assertEq(factory.poolCount(), 0);
            factories[c] = address(factory);
            for (uint256 i; i < 4; i++) {
                string memory k = string.concat('.privacy.pools["', specs[i].label, '"]');
                KakushiPool pool = KakushiPool(vm.parseJsonAddress(json, string.concat(k, ".address")));
                assertEq(pool.denomination(), specs[i].denomination);
                assertEq(pool.token(), specs[i].token);
                assertEq(vm.parseJsonString(json, string.concat(k, ".denomination")), vm.toString(specs[i].denomination));
                assertEq(address(pool.verifier()), vm.parseJsonAddress(json, ".privacy.shieldedVerifier"));
                assertEq(address(pool.rootOracle()), address(0));
            }
            // idempotent re-run with the same verifier: nothing new deployed
            script.deploy(_cfg("local", vm.parseJsonAddress(json, ".privacy.shieldedVerifier")));
            assertEq(vm.readFile(path), json);
        }
        assertEq(stealthPay[0], stealthPay[1], "same StealthPay address on hub and spoke");
        assertTrue(factories[0] != address(0) && factories[1] != address(0));
        _clean();
    }
}
