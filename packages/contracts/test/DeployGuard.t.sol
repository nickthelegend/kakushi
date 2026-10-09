// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract DeployGuardTest is Test {
    Deploy internal deploy;
    function setUp() public {
        deploy = new Deploy();
        resetEnvironment();
    }
    function resetEnvironment() internal {
        vm.setEnv("DEPLOYER_PK", "1");
        vm.setEnv("KAKUSHI_ROLE", "hub");
        vm.setEnv("KAKUSHI_NETWORK", "local");
        vm.chainId(10143);
    }
    function test_RejectUnknownRoleBeforeBroadcast() public {
        resetEnvironment();
        vm.setEnv("KAKUSHI_ROLE", "hbu");
        vm.expectRevert("invalid Kakushi role"); deploy.run();
    }
    function test_RejectUnknownChainBeforeBroadcast() public {
        resetEnvironment();
        vm.chainId(1);
        vm.expectRevert("unsupported Kakushi chain"); deploy.run();
    }
    function test_RejectWrongRoleOnSpoke() public {
        resetEnvironment();
        vm.chainId(11155111);
        vm.expectRevert("role does not match chain"); deploy.run();
    }
    function test_RejectMisspelledNetwork() public {
        resetEnvironment();
        vm.setEnv("KAKUSHI_NETWORK", "tesnet");
        vm.expectRevert("invalid Kakushi network"); deploy.run();
    }
    function test_RequirePublicWorkflowOwner() public {
        resetEnvironment();
        vm.setEnv("KAKUSHI_NETWORK", "testnet");
        vm.setEnv("CRE_WORKFLOW_OWNER", "0x0000000000000000000000000000000000000000");
        vm.expectRevert("configure real CRE workflow owner"); deploy.run();
    }
    function test_RejectIncompleteImmutableCompliance() public {
        resetEnvironment();
        vm.setEnv("KAKUSHI_NETWORK", "testnet");
        vm.setEnv("CRE_WORKFLOW_OWNER", "0x0000000000000000000000000000000000000001");
        vm.setEnv("CLEANVERSE_CVA", "0x0000000000000000000000000000000000000001");
        vm.setEnv("CLEANVERSE_VALIDATOR", "0x0000000000000000000000000000000000000000");
        vm.expectRevert("incomplete compliance configuration"); deploy.run();
    }
    function test_RejectUnavailableFactory() public {
        resetEnvironment();
        vm.expectRevert("CreateX unavailable"); deploy.run();
    }
}
