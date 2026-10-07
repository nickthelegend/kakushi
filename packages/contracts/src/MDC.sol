// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Owned} from "./lib/Owned.sol";
import {Errors} from "./lib/Errors.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IERC20Min} from "./interfaces/IERC20Min.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {EBC} from "./EBC.sol";

/// @title MDC (Maker Deposit Contract): Maker margin on the Monad hub.
/// @notice Margin is the user's protection. It only leaves the contract in two ways:
///         (1) `slash`, callable solely by the DisputeModule after a verified ZK proof, and
///         only to the recorded sender/challenger; (2) `executeWithdraw` by the Maker, after
///         a timelock that outlasts every fill + attestation + dispute window, with no open
///         dispute, and never below the required margin. No owner or pause can move margin.
contract MDC is Owned, ReentrancyGuard {
    using SafeTransfer for address;

    struct PendingWithdraw {
        uint128 amount;
        uint64 unlockAt;
    }

    uint256 public constant BPS = 10_000;

    EBC public immutable ebc;
    /// @notice required margin = marginFactorBps/10_000 x the largest pair limit (k = 1.1 default)
    uint256 public immutable marginFactorBps;
    /// @notice haircut applied to priced (cross-asset) margin, in bps (2000 = 20%)
    uint256 public immutable priceHaircutBps;
    /// @notice premium added to priced compensation, in bps (1000 = 10%)
    uint256 public immutable compensationPremiumBps;
    /// @notice Chainlink answers older than this block priced withdrawals (fail safe)
    uint256 public immutable maxPriceAge;
    /// @notice withdraw timelock = FILL_WINDOW + max attestation lag + DISPUTE_WINDOW
    uint64 public immutable withdrawDelay;

    /// @notice set once by the owner, then frozen
    address public disputeModule;

    mapping(address maker => mapping(address token => uint256)) public margin;
    mapping(address maker => mapping(address token => PendingWithdraw)) public pendingWithdraw;
    mapping(address maker => uint256) public openDisputes;

    event MarginDeposited(address indexed maker, address indexed token, uint256 amount, uint256 total);
    event WithdrawRequested(address indexed maker, address indexed token, uint256 amount, uint64 unlockAt);
    event WithdrawCancelled(address indexed maker, address indexed token);
    event MarginWithdrawn(address indexed maker, address indexed token, uint256 amount, uint256 remaining);
    event MarginSlashed(
        address indexed maker, address indexed token, address indexed to, uint256 requested, uint256 paid, bytes32 disputeKey
    );
    event DisputeModuleSet(address indexed disputeModule);

    constructor(
        address owner_,
        EBC ebc_,
        uint256 marginFactorBps_,
        uint256 priceHaircutBps_,
        uint256 compensationPremiumBps_,
        uint256 maxPriceAge_,
        uint64 withdrawDelay_
    ) Owned(owner_) {
        ebc = ebc_;
        marginFactorBps = marginFactorBps_;
        priceHaircutBps = priceHaircutBps_;
        compensationPremiumBps = compensationPremiumBps_;
        maxPriceAge = maxPriceAge_;
        withdrawDelay = withdrawDelay_;
    }

    function setDisputeModule(address dm) external onlyOwner {
        if (disputeModule != address(0)) revert Errors.AlreadyConfigured();
        if (dm == address(0)) revert Errors.ZeroAddress();
        disputeModule = dm;
        emit DisputeModuleSet(dm);
    }

    modifier onlyDisputeModule() {
        if (msg.sender != disputeModule) revert Errors.NotDisputeModule();
        _;
    }

    // ------------------------------------------------------------------ maker

    function depositMargin(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert Errors.InvalidParams();
        token.safeTransferFrom(msg.sender, address(this), amount);
        margin[msg.sender][token] += amount;
        emit MarginDeposited(msg.sender, token, amount, margin[msg.sender][token]);
    }

    function requestWithdraw(address token, uint256 amount) external {
        if (amount == 0 || amount > margin[msg.sender][token]) {
            revert Errors.InsufficientMargin(margin[msg.sender][token], amount);
        }
        uint64 unlockAt = uint64(block.timestamp) + withdrawDelay;
        pendingWithdraw[msg.sender][token] = PendingWithdraw(uint128(amount), unlockAt);
        emit WithdrawRequested(msg.sender, token, amount, unlockAt);
    }

    function cancelWithdraw(address token) external {
        delete pendingWithdraw[msg.sender][token];
        emit WithdrawCancelled(msg.sender, token);
    }

    function executeWithdraw(address token) external nonReentrant {
        PendingWithdraw memory pw = pendingWithdraw[msg.sender][token];
        if (pw.amount == 0) revert Errors.NoPendingWithdraw();
        if (block.timestamp < pw.unlockAt) revert Errors.WithdrawLocked(pw.unlockAt);
        uint256 open = openDisputes[msg.sender];
        if (open != 0) revert Errors.OpenDisputes(open);
        uint256 bal = margin[msg.sender][token];
        if (pw.amount > bal) revert Errors.InsufficientMargin(bal, pw.amount);
        uint256 remaining = bal - pw.amount;
        uint256 req = required(msg.sender, token);
        if (remaining < req) revert Errors.MarginBelowRequired(remaining, req);

        delete pendingWithdraw[msg.sender][token];
        margin[msg.sender][token] = remaining;
        token.safeTransfer(msg.sender, pw.amount);
        emit MarginWithdrawn(msg.sender, token, pw.amount, remaining);
    }

    // ------------------------------------------------------------------ views

    /// @notice Required margin in `token` for `maker`: k x the largest limit (valued in the
    ///         margin token) over every pair backed by `token` that is active or was active
    ///         within the withdraw delay. Reverts StalePrice if a priced pair's feed is stale
    ///         (fail safe: withdrawals block, disputes never do).
    function required(address maker, address token) public view returns (uint256 maxValue) {
        bytes32[] memory ids = ebc.makerPairs(maker);
        for (uint256 i; i < ids.length; i++) {
            EBC.Pair memory p = ebc.getPair(ids[i]);
            EBC.MarginConfig memory mc = ebc.marginConfigOf(maker, p.srcChainId, p.srcToken);
            if (mc.marginToken != token) continue;
            uint256 limit = ebc.exposureLimit(ids[i], withdrawDelay);
            if (limit == 0) continue;
            uint256 value = _value(limit, mc, true, priceHaircutBps);
            if (value > maxValue) maxValue = value;
        }
        maxValue = (maxValue * marginFactorBps) / BPS;
    }

    /// @notice Margin-token amount owed to a sender whose `gross` payment was not honoured.
    ///         Same asset: gross converted between decimals. Priced asset: gross x Chainlink
    ///         price x (1 + premium); a stale price is still used (never blocks a victim).
    function compensation(uint256 gross, address marginToken, address priceFeed, uint8 srcDecimals)
        public
        view
        returns (uint256)
    {
        EBC.MarginConfig memory mc = EBC.MarginConfig(marginToken, priceFeed, srcDecimals, true);
        return _value(gross, mc, false, compensationPremiumBps);
    }

    function _value(uint256 amount, EBC.MarginConfig memory mc, bool strictPrice, uint256 adjustBps)
        internal
        view
        returns (uint256)
    {
        uint8 mDec = IERC20Min(mc.marginToken).decimals();
        if (mc.priceFeed == address(0)) {
            return _scale(amount, mc.srcDecimals, mDec);
        }
        IAggregatorV3 feed = IAggregatorV3(mc.priceFeed);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert Errors.BadPrice();
        if (strictPrice && updatedAt + maxPriceAge < block.timestamp) revert Errors.StalePrice(updatedAt);
        uint8 fDec = feed.decimals();
        // amount (srcDecimals) * price (fDec) -> margin decimals
        uint256 v = _scale(amount * uint256(answer), mc.srcDecimals + fDec, mDec);
        return (v * (BPS + adjustBps)) / BPS;
    }

    function _scale(uint256 amount, uint256 fromDec, uint256 toDec) internal pure returns (uint256) {
        if (fromDec == toDec) return amount;
        if (fromDec > toDec) return amount / (10 ** (fromDec - toDec));
        return amount * (10 ** (toDec - fromDec));
    }

    // ------------------------------------------------------------------ dispute module

    function lockDispute(address maker) external onlyDisputeModule {
        openDisputes[maker] += 1;
    }

    function unlockDispute(address maker) external onlyDisputeModule {
        openDisputes[maker] -= 1;
    }

    /// @notice Move up to `amount` of the Maker's margin to `to`. Only the DisputeModule,
    ///         only after a verified proof. Pays what is available; returns the amount paid.
    function slash(address maker, address token, address to, uint256 amount, bytes32 disputeKey)
        external
        onlyDisputeModule
        nonReentrant
        returns (uint256 paid)
    {
        uint256 bal = margin[maker][token];
        paid = amount > bal ? bal : amount;
        margin[maker][token] = bal - paid;
        if (paid != 0) token.safeTransfer(to, paid);
        emit MarginSlashed(maker, token, to, amount, paid, disputeKey);
    }
}
