// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ICreateX} from "./Deploy.s.sol";
import {StealthRegistry} from "../src/privacy/StealthRegistry.sol";
import {StealthAnnouncer} from "../src/privacy/StealthAnnouncer.sol";
import {StealthPay} from "../src/privacy/StealthPay.sol";
import {KakushiPool} from "../src/privacy/KakushiPool.sol";
import {KakushiPoolFactory} from "../src/privacy/KakushiPoolFactory.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IRootOracle} from "../src/interfaces/IRootOracle.sol";
import {IERC5564Announcer} from "../src/interfaces/IERC5564Announcer.sol";
import {ShieldedWithdrawVerifier} from "../src/verifiers/ShieldedWithdrawVerifier.sol";

/// @notice Deploys the Kakushi privacy layer on one chain (hub or any spoke):
///   - StealthRegistry (ERC-6538), StealthAnnouncer (ERC-5564), StealthPay: through CreateX with a
///     deployer-guarded salt, so they have the SAME address on every chain;
///   - ShieldedWithdrawVerifier (+ its linked libraries): plain CREATE, or reused from
///     SHIELDED_VERIFIER when that address has code;
///   - KakushiPool per (token, denomination): through CreateX, so a re-run with the same verifier
///     reuses them. Denominations: USDC 10 and 100 everywhere; native 1 and 10 MON on Monad,
///     0.01 and 0.1 ETH on the ETH chains. Root oracle: none (address(0)), see IRootOracle.
///   - KakushiPoolFactory (permissionless "any token -> private" pools on the same verifier):
///     through CreateX, recorded as `poolFactory`. The curated pools above are not registered in
///     it (they predate it and keep working); the factory serves every other (token, denomination).
/// Run it AFTER script/Deploy.s.sol: it merges a `privacy` object into deployments/<network>/<chainId>.json
/// (Deploy.s.sol rewrites that file, so re-run this one after it).
///
///   forge script script/DeployPrivacy.s.sol --rpc-url $RPC --broadcast
///   (env: DEPLOYER_PK, KAKUSHI_NETWORK, optional SHIELDED_VERIFIER, KAKUSHI_DEPLOYMENTS_DIR)
contract DeployPrivacy is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);
    uint64 constant MONAD_TESTNET = 10143;
    uint64 constant SEPOLIA = 11155111;
    uint64 constant BASE_SEPOLIA = 84532;
    uint64 constant ARBITRUM_SEPOLIA = 421614;
    uint64 constant OP_SEPOLIA = 11155420;

    struct PoolSpec {
        string label;
        address token;
        string symbol;
        uint8 decimals;
        uint256 denomination;
    }

    struct Config {
        uint256 deployerPk;
        string network; // "local" | "testnet"
        string dir; // deployments root
        address verifier; // reuse when it has code, else deploy a new ShieldedWithdrawVerifier
    }

    function run() external {
        deploy(
            Config({
                deployerPk: vm.envUint("DEPLOYER_PK"),
                network: vm.envOr("KAKUSHI_NETWORK", string("local")),
                dir: vm.envOr("KAKUSHI_DEPLOYMENTS_DIR", string("deployments")),
                verifier: vm.envOr("SHIELDED_VERIFIER", address(0))
            })
        );
    }

    /// addresses written to the `privacy` object
    struct Out {
        address registry;
        address announcer;
        address stealthPay;
        address verifier;
        address poolFactory;
    }

    function deploy(Config memory c) public {
        uint256 pk = c.deployerPk;
        address deployer = vm.addr(pk);
        _validate(c.network);
        string memory path = string.concat(c.dir, "/", c.network, "/", vm.toString(block.chainid), ".json");

        vm.startBroadcast(pk);
        Out memory o;
        o.registry = _create2(_salt(deployer, "kakushi.StealthRegistry.v1"), type(StealthRegistry).creationCode);
        o.announcer = _create2(_salt(deployer, "kakushi.StealthAnnouncer.v1"), type(StealthAnnouncer).creationCode);
        o.stealthPay = _create2(
            _salt(deployer, "kakushi.StealthPay.v1"),
            abi.encodePacked(type(StealthPay).creationCode, abi.encode(IERC5564Announcer(o.announcer)))
        );
        o.verifier = c.verifier;
        if (o.verifier.code.length == 0) o.verifier = address(new ShieldedWithdrawVerifier());
        o.poolFactory = _create2(
            _salt(deployer, "kakushi.KakushiPoolFactory.v1"),
            abi.encodePacked(type(KakushiPoolFactory).creationCode, abi.encode(IVerifier(o.verifier)))
        );

        PoolSpec[] memory specs = poolSpecs(block.chainid);
        address[] memory pools = new address[](specs.length);
        for (uint256 i; i < specs.length; i++) {
            if (specs[i].token != address(0) && specs[i].token.code.length == 0) {
                console2.log("skipping pool, token has no code:", specs[i].label);
                continue;
            }
            bytes memory init = abi.encodePacked(
                type(KakushiPool).creationCode,
                abi.encode(IVerifier(o.verifier), specs[i].token, specs[i].denomination, IRootOracle(address(0)))
            );
            pools[i] = _create2(_salt(deployer, string.concat("kakushi.KakushiPool.v1.", specs[i].label)), init);
        }
        vm.stopBroadcast();
        _write(path, o, specs, pools);
    }

    function _write(string memory path, Out memory o, PoolSpec[] memory specs, address[] memory pools) internal {
        string memory p = "privacy";
        vm.serializeUint(p, "deployBlock", block.number);
        vm.serializeAddress(p, "stealthRegistry", o.registry);
        vm.serializeAddress(p, "stealthAnnouncer", o.announcer);
        vm.serializeAddress(p, "stealthPay", o.stealthPay);
        vm.serializeAddress(p, "shieldedVerifier", o.verifier);
        vm.serializeAddress(p, "poolFactory", o.poolFactory);
        string memory poolsJson = "{}";
        for (uint256 i; i < specs.length; i++) {
            if (pools[i] == address(0)) continue;
            string memory e = string.concat("pool.", specs[i].label);
            vm.serializeAddress(e, "address", pools[i]);
            vm.serializeAddress(e, "token", specs[i].token);
            vm.serializeString(e, "symbol", specs[i].symbol);
            vm.serializeUint(e, "decimals", specs[i].decimals);
            string memory entry = vm.serializeString(e, "denomination", vm.toString(specs[i].denomination));
            poolsJson = vm.serializeString("pools", specs[i].label, entry);
        }
        string memory privacy = vm.serializeString(p, "pools", poolsJson);

        string memory obj = "deployment";
        if (vm.exists(path)) vm.serializeJson(obj, vm.readFile(path));
        string memory json = vm.serializeString(obj, "privacy", privacy);
        vm.writeJson(json, path);
        console2.log("wrote privacy deployment to", path);
    }

    /// The pools of one chain. USDC addresses mirror config/chains.ts.
    function poolSpecs(uint256 chainId) public pure returns (PoolSpec[] memory s) {
        s = new PoolSpec[](4);
        address usdc;
        if (chainId == MONAD_TESTNET) {
            usdc = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
            s[0] = PoolSpec("MON-1", address(0), "MON", 18, 1 ether);
            s[1] = PoolSpec("MON-10", address(0), "MON", 18, 10 ether);
        } else {
            if (chainId == SEPOLIA) usdc = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
            else if (chainId == BASE_SEPOLIA) usdc = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
            else if (chainId == ARBITRUM_SEPOLIA) usdc = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
            else if (chainId == OP_SEPOLIA) usdc = 0x5fd84259d66Cd46123540766Be93DFE6D43130D7;
            else revert("unsupported Kakushi chain");
            s[0] = PoolSpec("ETH-0.01", address(0), "ETH", 18, 0.01 ether);
            s[1] = PoolSpec("ETH-0.1", address(0), "ETH", 18, 0.1 ether);
        }
        s[2] = PoolSpec("USDC-10", usdc, "USDC", 6, 10e6);
        s[3] = PoolSpec("USDC-100", usdc, "USDC", 6, 100e6);
    }

    function _validate(string memory network) internal view {
        require(
            block.chainid == MONAD_TESTNET || block.chainid == SEPOLIA || block.chainid == BASE_SEPOLIA
                || block.chainid == ARBITRUM_SEPOLIA || block.chainid == OP_SEPOLIA,
            "unsupported Kakushi chain"
        );
        require(
            keccak256(bytes(network)) == keccak256("local") || keccak256(bytes(network)) == keccak256("testnet"),
            "invalid Kakushi network"
        );
        require(address(CREATEX).code.length > 0, "CreateX unavailable");
    }

    function _salt(address deployer, string memory label) internal pure returns (bytes32) {
        // CreateX guarded salt: [20 bytes deployer][0x00 = same address on every chain][11 bytes entropy]
        return bytes32(abi.encodePacked(deployer, hex"00", bytes11(keccak256(bytes(label)))));
    }

    function _create2(bytes32 salt, bytes memory initCode) internal returns (address addr) {
        addr = CREATEX.computeCreate2Address(_guardedSalt(salt), keccak256(initCode));
        if (addr.code.length == 0) addr = CREATEX.deployCreate2(salt, initCode);
    }

    function _guardedSalt(bytes32 salt) internal pure returns (bytes32) {
        address sender = address(bytes20(salt));
        return keccak256(abi.encode(bytes32(uint256(uint160(sender))), salt));
    }
}
