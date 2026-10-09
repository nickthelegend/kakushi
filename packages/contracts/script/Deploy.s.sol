// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EBC} from "../src/EBC.sol";
import {MDC} from "../src/MDC.sol";
import {AttestationOracle} from "../src/AttestationOracle.sol";
import {DisputeModule} from "../src/DisputeModule.sol";
import {PayoutRouter} from "../src/PayoutRouter.sol";
import {SourceRouter} from "../src/SourceRouter.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {PaymentComplianceVerifier} from "../src/verifiers/PaymentComplianceVerifier.sol";
import {PayoutInclusionVerifier} from "../src/verifiers/PayoutInclusionVerifier.sol";

interface ICreateX {
    function deployCreate2(bytes32 salt, bytes memory initCode) external payable returns (address);
    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) external view returns (address);
}

/// @notice Deploys Kakushi on one chain.
///   KAKUSHI_ROLE=hub   -> Monad: EBC, MDC, AttestationOracle, verifiers, DisputeModule + routers
///   KAKUSHI_ROLE=spoke -> Sepolia / Base Sepolia: PayoutRouter + SourceRouter only
/// Routers go through CreateX with a deployer-guarded salt, so they have the SAME address on
/// every chain. Writes deployments/<chainId>.json.
///
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast   (env: DEPLOYER_PK, KAKUSHI_ROLE, ...)
contract Deploy is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);
    uint64 constant MONAD_TESTNET = 10143;
    uint64 constant SEPOLIA = 11155111;
    uint64 constant BASE_SEPOLIA = 84532;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        string memory role = vm.envOr("KAKUSHI_ROLE", string("spoke"));
        string memory network = vm.envOr("KAKUSHI_NETWORK", string("local"));
        _validateRelease(role, network);
        string memory path = string.concat("deployments/", network, "/", vm.toString(block.chainid), ".json");
        string memory obj = "deployment";

        vm.startBroadcast(pk);
        (address payoutRouter, address sourceRouter) = _routers(deployer);
        vm.serializeAddress(obj, "payoutRouter", payoutRouter);
        vm.serializeAddress(obj, "sourceRouter", sourceRouter);
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeAddress(obj, "deployer", deployer);

        if (keccak256(bytes(role)) == keccak256("hub")) {
            _hub(obj, deployer);
        }
        vm.stopBroadcast();

        string memory json = vm.serializeString(obj, "role", role);
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }

    /// Validate before broadcasting or freezing immutable sponsor configuration.
    function _validateRelease(string memory role, string memory network) internal view {
        bool hub = keccak256(bytes(role)) == keccak256("hub");
        bool spoke = keccak256(bytes(role)) == keccak256("spoke");
        require(hub || spoke, "invalid Kakushi role");
        require(block.chainid == MONAD_TESTNET || block.chainid == SEPOLIA || block.chainid == BASE_SEPOLIA, "unsupported Kakushi chain");
        require(hub == (block.chainid == MONAD_TESTNET), "role does not match chain");
        bool local = keccak256(bytes(network)) == keccak256("local");
        require(local || keccak256(bytes(network)) == keccak256("testnet"), "invalid Kakushi network");
        if (!local && hub) {
            require(vm.envOr("CRE_WORKFLOW_OWNER", address(0)) != address(0), "configure real CRE workflow owner");
            require(vm.envExists("CLEANVERSE_CVA") && vm.envExists("CLEANVERSE_VALIDATOR"), "choose explicit compliance configuration");
            address cva = vm.envAddress("CLEANVERSE_CVA");
            address validator = vm.envAddress("CLEANVERSE_VALIDATOR");
            require((cva == address(0)) == (validator == address(0)), "incomplete compliance configuration");
            if (cva != address(0)) require(cva.code.length > 0 && validator.code.length > 0, "compliance contracts unavailable");
            require(vm.envOr("CRE_FORWARDER", address(0)).code.length > 0, "configure deployed CRE forwarder");
        }
        require(address(CREATEX).code.length > 0, "CreateX unavailable");
    }

    function _routers(address deployer) internal returns (address pr, address sr) {
        bytes32 prSalt = _salt(deployer, "kakushi.PayoutRouter.v1");
        bytes32 srSalt = _salt(deployer, "kakushi.SourceRouter.v1");
        bytes memory prInit = abi.encodePacked(type(PayoutRouter).creationCode, abi.encode(deployer));
        bytes memory srInit = abi.encodePacked(type(SourceRouter).creationCode, abi.encode(deployer));
        pr = _create2(prSalt, prInit);
        sr = _create2(srSalt, srInit);

        PayoutRouter payout = PayoutRouter(pr);
        if (!payout.complianceFrozen()) {
            // Cleanverse compliant lane only on Monad; frozen empty elsewhere
            if (block.chainid == MONAD_TESTNET) {
                address cva = vm.envOr("CLEANVERSE_CVA", address(0xfA96De5B8F434c26FdFf953303dD66fF80af1026));
                address validator = vm.envOr("CLEANVERSE_VALIDATOR", address(0xaC7e5179C2C7f03f209136886c172eb34F161792));
                payout.initCompliance(cva, validator, pr);
            } else {
                payout.initCompliance(address(0), address(0), address(0));
            }
        }
        SourceRouter source = SourceRouter(sr);
        uint16[4] memory codes = [uint16(9001), 9002, 9003, 9101];
        for (uint256 i; i < codes.length; i++) {
            if (!source.knownCodes(codes[i])) source.setCode(codes[i], true);
        }
    }

    struct HubCfg {
        uint64 fillWindow;
        uint64 disputeWindow;
        uint64 skew;
        uint64 paramDelay;
        uint64 attestLagMax;
        address forwarder;
        address workflowOwner;
        uint256 bond;
    }

    function _hubCfg() internal view returns (HubCfg memory c) {
        c.fillWindow = uint64(vm.envOr("KAKUSHI_FILL_WINDOW", uint256(20)));
        c.disputeWindow = uint64(vm.envOr("KAKUSHI_DISPUTE_WINDOW", uint256(120)));
        c.skew = uint64(vm.envOr("KAKUSHI_CLOCK_SKEW", uint256(10)));
        c.paramDelay = uint64(vm.envOr("KAKUSHI_PARAM_DELAY", uint256(60)));
        c.attestLagMax = uint64(vm.envOr("KAKUSHI_ATTEST_LAG_MAX", uint256(60)));
        c.forwarder = vm.envOr("CRE_FORWARDER", address(0xB9F79d863261869B234c481D1f9A7af84AeAd192));
        c.workflowOwner = vm.envOr("CRE_WORKFLOW_OWNER", address(0));
        c.bond = vm.envOr("KAKUSHI_DISPUTE_BOND", uint256(0.05 ether));
    }

    function _hub(string memory obj, address deployer) internal {
        HubCfg memory c = _hubCfg();
        EBC ebc = new EBC(deployer, deployer, c.paramDelay);
        MDC mdc = new MDC(deployer, ebc, 11_000, 2_000, 1_000, 26 hours, c.fillWindow + c.attestLagMax + c.disputeWindow);
        AttestationOracle oracle = new AttestationOracle(c.forwarder, c.workflowOwner);
        DisputeModule dm = _disputeModule(c, ebc, mdc, oracle);
        mdc.setDisputeModule(address(dm));
        ebc.registerIdentCode(9001, MONAD_TESTNET);
        ebc.registerIdentCode(9002, SEPOLIA);
        ebc.registerIdentCode(9003, BASE_SEPOLIA);
        ebc.registerIdentCode(9101, MONAD_TESTNET); // Cleanverse compliant lane (aUSDC)

        vm.serializeAddress(obj, "ebc", address(ebc));
        vm.serializeAddress(obj, "mdc", address(mdc));
        vm.serializeAddress(obj, "attestationOracle", address(oracle));
        vm.serializeAddress(obj, "complianceVerifier", address(dm.complianceVerifier()));
        vm.serializeAddress(obj, "inclusionVerifier", address(dm.inclusionVerifier()));
        vm.serializeAddress(obj, "disputeModule", address(dm));
        vm.serializeAddress(obj, "creForwarder", c.forwarder);
        vm.serializeUint(obj, "fillWindow", c.fillWindow);
        vm.serializeUint(obj, "disputeWindow", c.disputeWindow);
        vm.serializeUint(obj, "clockSkew", c.skew);
        vm.serializeUint(obj, "paramDelay", c.paramDelay);
        vm.serializeUint(obj, "withdrawDelay", c.fillWindow + c.attestLagMax + c.disputeWindow);
        vm.serializeUint(obj, "bond", c.bond);
        vm.serializeBytes32(obj, "domain", dm.domain());
    }

    function _disputeModule(HubCfg memory c, EBC ebc, MDC mdc, AttestationOracle oracle) internal returns (DisputeModule) {
        return new DisputeModule(
            DisputeModule.Config({
                ebc: ebc,
                mdc: mdc,
                oracle: oracle,
                complianceVerifier: IVerifier(address(new PaymentComplianceVerifier())),
                inclusionVerifier: IVerifier(address(new PayoutInclusionVerifier())),
                bondAmount: c.bond,
                fillWindow: c.fillWindow,
                disputeWindow: c.disputeWindow,
                clockSkew: c.skew,
                challengerRewardBps: 100
            })
        );
    }

    function _salt(address deployer, string memory label) internal pure returns (bytes32) {
        // CreateX guarded salt: [20 bytes deployer][0x00 = same address on every chain][11 bytes entropy]
        return bytes32(abi.encodePacked(deployer, hex"00", bytes11(keccak256(bytes(label)))));
    }

    function _create2(bytes32 salt, bytes memory initCode) internal returns (address addr) {
        // if the contract already exists at the predicted address (re-run), reuse it
        addr = CREATEX.computeCreate2Address(_guardedSalt(salt), keccak256(initCode));
        if (addr.code.length == 0) {
            addr = CREATEX.deployCreate2(salt, initCode);
        }
    }

    /// CreateX `_guard` for a salt whose first 20 bytes equal msg.sender and byte 21 is 0x00:
    /// guardedSalt = keccak256(abi.encode(bytes32(uint256(uint160(msg.sender))), salt)).
    function _guardedSalt(bytes32 salt) internal view returns (bytes32) {
        address sender = address(bytes20(salt));
        return keccak256(abi.encode(bytes32(uint256(uint160(sender))), salt));
    }
}
