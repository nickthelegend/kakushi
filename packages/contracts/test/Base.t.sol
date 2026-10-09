// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EBC} from "../src/EBC.sol";
import {MDC} from "../src/MDC.sol";
import {AttestationOracle} from "../src/AttestationOracle.sol";
import {DisputeModule} from "../src/DisputeModule.sol";
import {PayoutRouter} from "../src/PayoutRouter.sol";
import {SourceRouter} from "../src/SourceRouter.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {Kinds} from "../src/lib/Kinds.sol";
import {SrcRef} from "../src/lib/SrcRef.sol";
import {PaymentComplianceVerifier} from "../src/verifiers/PaymentComplianceVerifier.sol";
import {PayoutInclusionVerifier} from "../src/verifiers/PayoutInclusionVerifier.sol";
import {TestToken, ToggleVerifier} from "./utils/TestToken.sol";

/// @notice Shared deployment for the Kakushi test suite. The hub runs as Monad testnet (10143).
abstract contract Base is Test {
    uint64 constant HUB = 10143;
    uint64 constant SEPOLIA = 11155111;
    uint64 constant BASE_SEPOLIA = 84532;
    uint64 constant ARBITRUM_SEPOLIA = 421614;
    uint64 constant OP_SEPOLIA = 11155420;
    uint16 constant CODE_MONAD = 9001;
    uint16 constant CODE_SEPOLIA = 9002;
    uint16 constant CODE_BASE = 9003;
    uint16 constant CODE_ARBITRUM = 9004;
    uint16 constant CODE_OP = 9005;

    uint64 constant FILL_WINDOW = 20;
    uint64 constant DISPUTE_WINDOW = 120;
    uint64 constant SKEW = 10;
    uint64 constant PARAM_DELAY = 60;
    uint64 constant WITHDRAW_DELAY = 200;
    uint256 constant BOND = 0.05 ether;

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address maker = makeAddr("maker");
    address sender = makeAddr("sender");
    address challenger = makeAddr("challenger");
    address forwarder; // the test contract acts as the CRE forwarder

    // "Sepolia USDC" is just an address on the source chain from the hub's point of view
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    EBC ebc;
    MDC mdc;
    AttestationOracle oracle;
    DisputeModule dm;
    TestToken usdc; // Monad-side USDC (margin + payout token)
    IVerifier complianceV;
    IVerifier inclusionV;

    function setUp() public virtual {
        vm.chainId(HUB);
        vm.warp(1_800_000_000);
        forwarder = address(this);
        usdc = new TestToken("USD Coin", "USDC", 6);
        ebc = new EBC(owner, guardian, PARAM_DELAY);
        mdc = new MDC(owner, ebc, 11_000, 2_000, 1_000, 26 hours, WITHDRAW_DELAY);
        oracle = new AttestationOracle(forwarder, address(0));
        (complianceV, inclusionV) = _verifiers();
        dm = new DisputeModule(
            DisputeModule.Config({
                ebc: ebc,
                mdc: mdc,
                oracle: oracle,
                complianceVerifier: complianceV,
                inclusionVerifier: inclusionV,
                bondAmount: BOND,
                fillWindow: FILL_WINDOW,
                disputeWindow: DISPUTE_WINDOW,
                clockSkew: SKEW,
                challengerRewardBps: 100
            })
        );
        vm.prank(owner);
        mdc.setDisputeModule(address(dm));
        vm.startPrank(owner);
        ebc.registerIdentCode(CODE_MONAD, HUB);
        ebc.registerIdentCode(CODE_SEPOLIA, SEPOLIA);
        ebc.registerIdentCode(CODE_BASE, BASE_SEPOLIA);
        ebc.registerIdentCode(CODE_ARBITRUM, ARBITRUM_SEPOLIA);
        ebc.registerIdentCode(CODE_OP, OP_SEPOLIA);
        vm.stopPrank();
        vm.deal(challenger, 10 ether);
        vm.deal(sender, 10 ether);
    }

    /// real UltraHonk verifiers by default; unit tests may override with ToggleVerifier
    function _verifiers() internal virtual returns (IVerifier, IVerifier) {
        return (IVerifier(address(new PaymentComplianceVerifier())), IVerifier(address(new PayoutInclusionVerifier())));
    }

    // ------------------------------------------------------------ maker helpers

    /// USDC Sepolia -> Monad, code 9001, withholding 0.05 USDC, 10 bps, 1..500 USDC; margin 600 USDC.
    function _registerUsdcPair() internal returns (bytes32 pairId) {
        vm.startPrank(maker);
        pairId = ebc.registerPair(
            EBC.Pair(maker, SEPOLIA, SEPOLIA_USDC, HUB, address(usdc), CODE_MONAD),
            EBC.Params(0, 50_000, 10, 1_000_000, 500_000_000),
            EBC.MarginConfig(address(usdc), address(0), 6, true)
        );
        ebc.setRefundFee(SEPOLIA, SEPOLIA_USDC, 30_000);
        vm.stopPrank();
    }

    function _depositMargin(uint256 amount) internal {
        usdc.mint(maker, amount);
        vm.startPrank(maker);
        usdc.approve(address(mdc), amount);
        mdc.depositMargin(address(usdc), amount);
        vm.stopPrank();
    }

    function _postWindow(uint64 chainId, uint8 kind, uint64 fromBlock, uint64 toBlock, uint64 fromTime, uint64 toTime, uint256 root)
        internal
        returns (uint256 id)
    {
        AttestationOracle.Window[] memory ws = new AttestationOracle.Window[](1);
        ws[0] = AttestationOracle.Window(chainId, kind, fromBlock, toBlock, fromTime, toTime, root, 1);
        oracle.onReport(abi.encodePacked(bytes32(0), bytes10(0), address(0), bytes2(0)), abi.encode(ws));
        id = oracle.windowCount();
    }

    // ------------------------------------------------------------ leaf / ffi helpers

    function _leaf(
        uint256 kind,
        uint256 chainId,
        bytes32 srcRef,
        address from,
        address to,
        address token,
        uint256 amount,
        address recipient,
        uint256 blockNumber,
        uint256 timestamp
    ) internal pure returns (string memory) {
        return string.concat(
            '["', vm.toString(kind), '","', vm.toString(chainId), '","', vm.toString(uint256(srcRef)), '","',
            vm.toString(uint256(uint160(from))), '","', vm.toString(uint256(uint160(to))), '","',
            vm.toString(uint256(uint160(token))), '","', vm.toString(amount), '","',
            vm.toString(uint256(uint160(recipient))), '","', vm.toString(blockNumber), '","', vm.toString(timestamp), '"]'
        );
    }

    struct Ctx {
        bytes32 srcRef;
        uint64 srcChainId;
        uint64 obligationChainId;
        address srcToken;
        address payToken;
        address recipient;
        uint256 gross;
        uint256 code;
        uint256 withholding;
        uint256 bps;
        uint256 expected;
        uint256 mode;
        uint64 srcTimestamp;
        DisputeModule disputeModule;
    }

    function _ctxJson(Ctx memory c) internal view returns (string memory) {
        string memory a = string.concat(
            '{"domain":"', vm.toString(uint256(c.disputeModule.domain())), '","srcChainId":"', vm.toString(uint256(c.srcChainId)),
            '","obligationChainId":"', vm.toString(uint256(c.obligationChainId)), '","srcRef":"', vm.toString(uint256(c.srcRef)),
            '","maker":"', vm.toString(uint256(uint160(maker))), '","sender":"', vm.toString(uint256(uint160(sender)))
        );
        string memory b = string.concat(
            '","recipient":"', vm.toString(uint256(uint160(c.recipient))), '","srcToken":"', vm.toString(uint256(uint160(c.srcToken))),
            '","payToken":"', vm.toString(uint256(uint160(c.payToken))), '","gross":"', vm.toString(c.gross),
            '","identCode":"', vm.toString(c.code), '","withholding":"', vm.toString(c.withholding)
        );
        string memory d = string.concat(
            '","bps":"', vm.toString(c.bps), '","expected":"', vm.toString(c.expected), '","mode":"', vm.toString(c.mode),
            '","srcTimestamp":"', vm.toString(uint256(c.srcTimestamp)), '","deadline":"', vm.toString(uint256(c.srcTimestamp + FILL_WINDOW)), '"}'
        );
        return string.concat(a, b, d);
    }

    /// Calls packages/attest-core/scripts/ffi.ts: builds the trees and a REAL proof.
    function _prove(string memory circuit, Ctx memory c, string memory sourceLeaves, string memory windows, uint256 inclusionWindow)
        internal
        returns (uint256 srcRoot, uint256[] memory roots, bytes memory proof)
    {
        string memory json = string.concat(
            '{"circuit":"', circuit, '","ctx":', _ctxJson(c), ',"source":', sourceLeaves, ',"windows":', windows,
            ',"inclusionWindow":', vm.toString(inclusionWindow), "}"
        );
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../attest-core/scripts/ffi.ts";
        cmd[2] = json;
        bytes memory out = vm.ffi(cmd);
        (srcRoot, roots, proof) = abi.decode(out, (uint256, uint256[], bytes));
    }

    function _srcRef(uint64 chainId, bytes32 txHash, uint32 logIndex) internal pure returns (bytes32) {
        return SrcRef.compute(chainId, txHash, logIndex);
    }
}
