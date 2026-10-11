// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KakushiExecutor} from "../src/lib/KakushiExecutor.sol";
import {KakushiInputVerifier} from "../src/lib/KakushiInputVerifier.sol";
import {KakushiDecryptionOracle} from "../src/oracle/KakushiDecryptionOracle.sol";
import {KakushiRegistry} from "../src/lib/KakushiRegistry.sol";
import {KakushiConfigStruct} from "../src/lib/KakushiTypes.sol";

interface ICreateX {
    function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address);
}

/// Deploys Kakushi on one chain. The registry goes to its CREATE3 address (same on every chain).
/// env: DEPLOYER (address, broadcasts; locally impersonated), INPUT_SIGNERS, KMS_SIGNERS (comma lists),
///      INPUT_THRESHOLD, KMS_THRESHOLD, CRE_FORWARDER (optional), REGISTRY_SALT, KAKUSHI_FHE_NETWORK
contract Deploy is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    function run() external {
        address deployer = vm.envAddress("DEPLOYER");
        address[] memory inputSigners = vm.envAddress("INPUT_SIGNERS", ",");
        address[] memory kmsSigners = vm.envAddress("KMS_SIGNERS", ",");
        uint256 inputK = vm.envOr("INPUT_THRESHOLD", uint256(2));
        uint256 kmsK = vm.envOr("KMS_THRESHOLD", uint256(2));
        address forwarder = vm.envOr("CRE_FORWARDER", address(0));
        bytes32 salt = vm.envBytes32("REGISTRY_SALT");
        string memory network = vm.envOr("KAKUSHI_FHE_NETWORK", string("local"));

        vm.startBroadcast(deployer);
        KakushiInputVerifier iv = new KakushiInputVerifier(deployer, inputSigners, inputK);
        KakushiExecutor ex = new KakushiExecutor(iv);
        KakushiDecryptionOracle oracle = new KakushiDecryptionOracle(ex.acl(), forwarder, deployer, kmsSigners, kmsK);
        address registry = CREATEX.deployCreate3(salt, abi.encodePacked(type(KakushiRegistry).creationCode, abi.encode(deployer)));
        KakushiRegistry(registry).setConfig(KakushiConfigStruct(address(ex.acl()), address(ex), address(iv), address(oracle)));
        vm.stopBroadcast();

        string memory o = "d";
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "acl", address(ex.acl()));
        vm.serializeAddress(o, "executor", address(ex));
        vm.serializeAddress(o, "inputVerifier", address(iv));
        vm.serializeAddress(o, "oracle", address(oracle));
        vm.serializeAddress(o, "creForwarder", forwarder);
        vm.serializeUint(o, "chainId", block.chainid);
        string memory json = vm.serializeUint(o, "deployBlock", block.number);
        vm.writeJson(json, string.concat("deployments/", network, ".json"));
        console2.log("registry", registry);
    }
}
