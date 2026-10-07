// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Owned} from "./lib/Owned.sol";
import {Errors} from "./lib/Errors.sol";
import {FeeMath} from "./lib/FeeMath.sol";
import {Kinds} from "./lib/Kinds.sol";

/// @title EBC (Event Binding Contract): the Kakushi rule book, on the Monad hub.
/// @notice Holds the ident-code registry and every Maker's pairs. A pair binds
///         (maker, srcChainId, srcToken, identCode) to a destination chain/token and fee
///         parameters. Parameter history is kept, so a dispute is judged with the
///         parameters that were in force when the source payment was made.
///
///         Rules (PLAN.md §7.3):
///         - code = gross % 10_000, principal = gross - code
///         - FILL if the pair was active at the source time and min <= principal <= max
///           and principal > withholding: net = base - floor(base * bps / 10_000)
///         - otherwise REFUND of principal - refundFee if the Maker trades that token on
///           that chain and principal > refundFee
///         - code 0000 is the inventory top-up code: never an obligation
contract EBC is Owned {
    struct Pair {
        address maker;
        uint64 srcChainId;
        address srcToken; // address(0) = native
        uint64 dstChainId;
        address dstToken; // address(0) = native
        uint16 identCode;
    }

    struct Params {
        uint64 effectiveFrom;
        uint128 withholdingFee;
        uint16 tradingFeeBps;
        uint128 minAmount;
        uint128 maxAmount;
    }

    struct ActiveFlag {
        uint64 since;
        bool active;
    }

    /// @notice How a Maker's margin covers a (srcChainId, srcToken): margin token on the hub,
    ///         optional Chainlink feed (0 = same asset), and the source token's decimals.
    struct MarginConfig {
        address marginToken;
        address priceFeed;
        uint8 srcDecimals;
        bool set;
    }

    struct RefundFee {
        uint64 effectiveFrom;
        uint128 fee;
    }

    struct Classification {
        uint8 kind; // Kinds.NONE / FILL / REFUND
        bytes32 pairId; // zero for REFUND of an unknown code
        uint256 expected; // amount the Maker must pay
        uint64 obligationChainId; // dst chain for FILL, src chain for REFUND
        address payToken;
        uint256 withholding; // fee param used (withholding or refundFee)
        uint256 bps; // trading fee bps (0 for REFUND)
        uint16 code;
        address marginToken;
        address priceFeed;
        uint8 srcDecimals;
    }

    uint256 public constant MAX_PAIRS_PER_MAKER = 16;
    uint16 public constant MAX_FEE_BPS = 1_000; // 10%

    /// @notice Delay before a parameter change (fees, limits) takes effect.
    uint64 public immutable paramDelay;

    address public guardian;
    bool public registrationsPaused;

    /// @notice ident code => destination chain id. Append-only.
    mapping(uint16 => uint64) public identCodeChain;

    mapping(bytes32 => Pair) internal _pairs;
    mapping(bytes32 => Params[]) internal _params;
    mapping(bytes32 => ActiveFlag[]) internal _active;
    mapping(address => bytes32[]) internal _makerPairs;
    /// @notice keccak(maker, srcChainId, srcToken) => margin config
    mapping(bytes32 => MarginConfig) internal _marginConfig;
    mapping(bytes32 => RefundFee[]) internal _refundFees;

    event IdentCodeRegistered(uint16 indexed code, uint64 indexed dstChainId);
    event PairRegistered(
        bytes32 indexed pairId,
        address indexed maker,
        uint64 srcChainId,
        address srcToken,
        uint64 dstChainId,
        address dstToken,
        uint16 identCode
    );
    event PairParamsQueued(
        bytes32 indexed pairId,
        uint64 effectiveFrom,
        uint128 withholdingFee,
        uint16 tradingFeeBps,
        uint128 minAmount,
        uint128 maxAmount
    );
    event PairActiveSet(bytes32 indexed pairId, bool active);
    event RefundFeeQueued(address indexed maker, uint64 indexed chainId, address token, uint64 effectiveFrom, uint128 fee);
    event GuardianSet(address indexed guardian);
    event RegistrationsPaused(bool paused);

    constructor(address owner_, address guardian_, uint64 paramDelay_) Owned(owner_) {
        guardian = guardian_;
        paramDelay = paramDelay_;
        emit GuardianSet(guardian_);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Register an ident code. Append-only: a code can never be re-pointed.
    function registerIdentCode(uint16 code, uint64 dstChainId) external onlyOwner {
        if (code == 0 || code >= FeeMath.CODE_MOD || dstChainId == 0) revert Errors.InvalidIdentCode(code);
        if (identCodeChain[code] != 0) revert Errors.IdentCodeTaken(code);
        identCodeChain[code] = dstChainId;
        emit IdentCodeRegistered(code, dstChainId);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Guardian/owner can pause NEW pair registrations only. Existing pairs,
    ///         obligations, margin and disputes are unaffected.
    function setRegistrationsPaused(bool paused) external {
        if (msg.sender != guardian && msg.sender != owner) revert Errors.NotGuardian();
        registrationsPaused = paused;
        emit RegistrationsPaused(paused);
    }

    // ------------------------------------------------------------------ makers

    function pairIdOf(address maker, uint64 srcChainId, address srcToken, uint16 code) public pure returns (bytes32) {
        return keccak256(abi.encode(maker, srcChainId, srcToken, code));
    }

    function marginKey(address maker, uint64 srcChainId, address srcToken) public pure returns (bytes32) {
        return keccak256(abi.encode(maker, srcChainId, srcToken));
    }

    /// @notice Register a pair. msg.sender must be the Maker. Takes effect immediately.
    function registerPair(Pair calldata p, Params calldata initial, MarginConfig calldata margin)
        external
        returns (bytes32 pairId)
    {
        if (registrationsPaused) revert Errors.Paused();
        if (p.maker != msg.sender) revert Errors.NotMaker();
        uint64 expectedChain = identCodeChain[p.identCode];
        if (expectedChain == 0) revert Errors.InvalidIdentCode(p.identCode);
        if (expectedChain != p.dstChainId) revert Errors.IdentCodeChainMismatch(p.identCode, expectedChain, p.dstChainId);
        if (p.srcChainId == 0 || p.srcChainId == p.dstChainId) revert Errors.InvalidParams();
        if (margin.marginToken == address(0)) revert Errors.ZeroAddress();
        _checkParams(initial);

        pairId = pairIdOf(p.maker, p.srcChainId, p.srcToken, p.identCode);
        if (_pairs[pairId].maker != address(0)) revert Errors.PairExists(pairId);
        if (_makerPairs[p.maker].length >= MAX_PAIRS_PER_MAKER) revert Errors.TooManyPairs();

        bytes32 mk = marginKey(p.maker, p.srcChainId, p.srcToken);
        MarginConfig storage mc = _marginConfig[mk];
        if (mc.set) {
            if (
                mc.marginToken != margin.marginToken || mc.priceFeed != margin.priceFeed
                    || mc.srcDecimals != margin.srcDecimals
            ) revert Errors.MarginConfigMismatch();
        } else {
            _marginConfig[mk] = MarginConfig(margin.marginToken, margin.priceFeed, margin.srcDecimals, true);
        }

        _pairs[pairId] = p;
        _params[pairId].push(
            Params(
                uint64(block.timestamp),
                initial.withholdingFee,
                initial.tradingFeeBps,
                initial.minAmount,
                initial.maxAmount
            )
        );
        _active[pairId].push(ActiveFlag(uint64(block.timestamp), true));
        _makerPairs[p.maker].push(pairId);

        emit PairRegistered(pairId, p.maker, p.srcChainId, p.srcToken, p.dstChainId, p.dstToken, p.identCode);
        emit PairParamsQueued(
            pairId, uint64(block.timestamp), initial.withholdingFee, initial.tradingFeeBps, initial.minAmount, initial.maxAmount
        );
        emit PairActiveSet(pairId, true);
    }

    /// @notice Queue new fee/limit parameters; they take effect after `paramDelay`.
    function updateParams(bytes32 pairId, Params calldata next) external {
        Pair storage p = _pairs[pairId];
        if (p.maker == address(0)) revert Errors.UnknownPair(pairId);
        if (p.maker != msg.sender) revert Errors.NotMaker();
        _checkParams(next);
        uint64 from = uint64(block.timestamp) + paramDelay;
        _params[pairId].push(Params(from, next.withholdingFee, next.tradingFeeBps, next.minAmount, next.maxAmount));
        emit PairParamsQueued(pairId, from, next.withholdingFee, next.tradingFeeBps, next.minAmount, next.maxAmount);
    }

    /// @notice Activate/deactivate a pair immediately. Deactivation turns new payments into
    ///         refund obligations; it never cancels obligations that already exist.
    function setActive(bytes32 pairId, bool active) external {
        Pair storage p = _pairs[pairId];
        if (p.maker == address(0)) revert Errors.UnknownPair(pairId);
        if (p.maker != msg.sender) revert Errors.NotMaker();
        _active[pairId].push(ActiveFlag(uint64(block.timestamp), active));
        emit PairActiveSet(pairId, active);
    }

    /// @notice Queue the flat fee a Maker withholds when refunding an unroutable payment of
    ///         `token` on `chainId`. Takes effect after `paramDelay` (immediately if first set).
    function setRefundFee(uint64 chainId, address token, uint128 fee) external {
        bytes32 mk = marginKey(msg.sender, chainId, token);
        if (!_marginConfig[mk].set) revert Errors.NotMaker();
        RefundFee[] storage hist = _refundFees[mk];
        uint64 from = hist.length == 0 ? uint64(block.timestamp) : uint64(block.timestamp) + paramDelay;
        hist.push(RefundFee(from, fee));
        emit RefundFeeQueued(msg.sender, chainId, token, from, fee);
    }

    // ------------------------------------------------------------------ views

    function getPair(bytes32 pairId) external view returns (Pair memory) {
        return _pairs[pairId];
    }

    function makerPairs(address maker) external view returns (bytes32[] memory) {
        return _makerPairs[maker];
    }

    function marginConfigOf(address maker, uint64 srcChainId, address srcToken)
        external
        view
        returns (MarginConfig memory)
    {
        return _marginConfig[marginKey(maker, srcChainId, srcToken)];
    }

    function paramsHistory(bytes32 pairId) external view returns (Params[] memory) {
        return _params[pairId];
    }

    function activeHistory(bytes32 pairId) external view returns (ActiveFlag[] memory) {
        return _active[pairId];
    }

    /// @notice Parameters in force at `ts`.
    function paramsAt(bytes32 pairId, uint64 ts) public view returns (Params memory params, bool found) {
        Params[] storage hist = _params[pairId];
        for (uint256 i = hist.length; i > 0; i--) {
            if (hist[i - 1].effectiveFrom <= ts) return (hist[i - 1], true);
        }
        return (params, false);
    }

    function isActiveAt(bytes32 pairId, uint64 ts) public view returns (bool) {
        ActiveFlag[] storage hist = _active[pairId];
        for (uint256 i = hist.length; i > 0; i--) {
            if (hist[i - 1].since <= ts) return hist[i - 1].active;
        }
        return false;
    }

    function refundFeeAt(address maker, uint64 chainId, address token, uint64 ts) public view returns (uint256) {
        RefundFee[] storage hist = _refundFees[marginKey(maker, chainId, token)];
        for (uint256 i = hist.length; i > 0; i--) {
            if (hist[i - 1].effectiveFrom <= ts) return hist[i - 1].fee;
        }
        return 0;
    }

    /// @notice Pure quote with explicit params (used by the SDK and the parity tests).
    function quote(uint256 gross, uint256 withholding, uint256 bps)
        external
        pure
        returns (uint16 code, uint256 principal, uint256 netAmount)
    {
        (code, principal) = FeeMath.split(gross);
        netAmount = FeeMath.net(principal, withholding, bps);
    }

    /// @notice Classify a source payment of `gross` of `srcToken` to `maker` on `srcChainId`
    ///         at time `ts` into the Maker's obligation (PLAN.md §7.3). Deterministic: depends
    ///         only on stored history, so disputes judge with the rules of the source time.
    function classify(address maker, uint64 srcChainId, address srcToken, uint256 gross, uint64 ts)
        external
        view
        returns (Classification memory c)
    {
        (uint16 code, uint256 principal) = FeeMath.split(gross);
        c.code = code;
        MarginConfig storage mc = _marginConfig[marginKey(maker, srcChainId, srcToken)];
        if (!mc.set || code == 0) return c; // not a Maker for this token, or a top-up: no obligation
        c.marginToken = mc.marginToken;
        c.priceFeed = mc.priceFeed;
        c.srcDecimals = mc.srcDecimals;

        bytes32 pairId = pairIdOf(maker, srcChainId, srcToken, code);
        Pair storage p = _pairs[pairId];
        if (p.maker != address(0) && isActiveAt(pairId, ts)) {
            (Params memory prm, bool found) = paramsAt(pairId, ts);
            if (
                found && principal >= prm.minAmount && principal <= prm.maxAmount && principal > prm.withholdingFee
            ) {
                c.kind = Kinds.FILL;
                c.pairId = pairId;
                c.expected = FeeMath.net(principal, prm.withholdingFee, prm.tradingFeeBps);
                c.obligationChainId = p.dstChainId;
                c.payToken = p.dstToken;
                c.withholding = prm.withholdingFee;
                c.bps = prm.tradingFeeBps;
                return c;
            }
        }

        uint256 rf = refundFeeAt(maker, srcChainId, srcToken, ts);
        if (principal > rf) {
            c.kind = Kinds.REFUND;
            c.pairId = p.maker != address(0) ? pairId : bytes32(0);
            c.expected = principal - rf;
            c.obligationChainId = srcChainId;
            c.payToken = srcToken;
            c.withholding = rf;
            c.bps = 0;
        }
    }

    /// @notice Largest maxAmount (in source units) the pair has had in its whole history
    ///         or has queued, if the pair is active or was active within `lookback` seconds.
    ///         MDC uses it to size required margin conservatively.
    function exposureLimit(bytes32 pairId, uint64 lookback) external view returns (uint256 limit) {
        ActiveFlag[] storage flags = _active[pairId];
        if (flags.length == 0) return 0;
        ActiveFlag storage last = flags[flags.length - 1];
        if (!last.active && uint256(last.since) + lookback < block.timestamp) return 0;
        Params[] storage hist = _params[pairId];
        for (uint256 i; i < hist.length; i++) {
            if (hist[i].maxAmount > limit) limit = hist[i].maxAmount;
        }
    }

    function _checkParams(Params calldata prm) internal pure {
        if (
            prm.minAmount == 0 || prm.maxAmount < prm.minAmount || prm.withholdingFee >= prm.minAmount
                || prm.tradingFeeBps > MAX_FEE_BPS
        ) revert Errors.InvalidParams();
    }
}
