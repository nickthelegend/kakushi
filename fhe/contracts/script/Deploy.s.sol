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
/// env: DEPLOYER (address), DEPLOYER_PK (optional: sign with this key, read from the environment so it
///      never appears on a command line; without it the script broadcasts as DEPLOYER, which a local
///      fork impersonates), INPUT_SIGNERS, KMS_SIGNERS (comma lists), INPUT_THRESHOLD, KMS_THRESHOLD,
///      CRE_FORWARDER (optional), REGISTRY_SALT, KAKUSHI_FHE_NETWORK
contract Deploy is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    struct Cfg {
        address deployer;
        uint256 pk;
        address[] inputSigners;
        address[] kmsSigners;
        uint256 inputK;
        uint256 kmsK;
        address forwarder;
        bytes32 salt;
        string network;
    }

    struct Out {
        KakushiInputVerifier iv;
        KakushiExecutor ex;
        KakushiDecryptionOracle oracle;
        address registry;
    }

    function run() external {
        Cfg memory c;
        c.deployer = vm.envAddress("DEPLOYER");
        c.inputSigners = vm.envAddress("INPUT_SIGNERS", ",");
        c.kmsSigners = vm.envAddress("KMS_SIGNERS", ",");
        c.inputK = vm.envOr("INPUT_THRESHOLD", uint256(2));
        c.kmsK = vm.envOr("KMS_THRESHOLD", uint256(2));
        c.forwarder = vm.envOr("CRE_FORWARDER", address(0));
        c.salt = vm.envBytes32("REGISTRY_SALT");
        c.network = vm.envOr("KAKUSHI_FHE_NETWORK", string("local"));
        c.pk = vm.envOr("DEPLOYER_PK", uint256(0));
        if (c.pk != 0) require(vm.addr(c.pk) == c.deployer, "DEPLOYER_PK is not DEPLOYER");
        // CreateX treats a salt whose first 20 bytes are not msg.sender as unguarded: the registry would
        // silently land elsewhere and KakushiConfig (which hard-codes the address) would not find it
        require(address(bytes20(c.salt)) == c.deployer, "REGISTRY_SALT is not guarded for DEPLOYER");

        if (c.pk != 0) vm.startBroadcast(c.pk);
        else vm.startBroadcast(c.deployer);
        Out memory o = _deploy(c);
        vm.stopBroadcast();
        _write(c, o);
    }

    function _deploy(Cfg memory c) internal returns (Out memory o) {
        o.iv = new KakushiInputVerifier(c.deployer, c.inputSigners, c.inputK);
        o.ex = new KakushiExecutor(o.iv);
        o.oracle = new KakushiDecryptionOracle(o.ex.acl(), c.forwarder, c.deployer, c.kmsSigners, c.kmsK);
        o.registry = CREATEX.deployCreate3(c.salt, abi.encodePacked(type(KakushiRegistry).creationCode, abi.encode(c.deployer)));
        KakushiRegistry(o.registry).setConfig(KakushiConfigStruct(address(o.ex.acl()), address(o.ex), address(o.iv), address(o.oracle)));
    }

    function _write(Cfg memory c, Out memory o) internal {
        string memory k = "d";
        vm.serializeAddress(k, "registry", o.registry);
        vm.serializeAddress(k, "acl", address(o.ex.acl()));
        vm.serializeAddress(k, "executor", address(o.ex));
        vm.serializeAddress(k, "inputVerifier", address(o.iv));
        vm.serializeAddress(k, "oracle", address(o.oracle));
        vm.serializeAddress(k, "creForwarder", c.forwarder);
        vm.serializeUint(k, "chainId", block.chainid);
        string memory json = vm.serializeUint(k, "deployBlock", block.number);
        vm.writeJson(json, string.concat("deployments/", c.network, ".json"));
        console2.log("registry", o.registry);
    }
}
