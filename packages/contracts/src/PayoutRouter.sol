// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Errors} from "./lib/Errors.sol";
import {Kinds} from "./lib/Kinds.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IComplianceValidator} from "./interfaces/IComplianceValidator.sol";

/// @title PayoutRouter: the only compliant way for a Maker to pay out (every chain).
/// @notice Stateless forwarder plus a one-payout-per-(maker, srcRef) guard. A Maker fills a
///         transfer on the destination chain (or refunds an unroutable payment on the source
///         chain) by calling `fill`/`refund`; funds move Maker -> recipient in the same tx and a
///         `Payout` log is emitted. The CRE attester commits every `Payout` log of a block window
///         into a sorted Poseidon2 tree; absence from that tree is what a dispute proves.
///
///         The guard is keyed by msg.sender, so nobody can front-run a Maker's fill with a dust
///         payout under the same srcRef. There is no pause and no owner power over funds.
///
///         Optional Cleanverse compliant lane: `initCompliance` (callable once, by the deployer)
///         names one CVA token whose payouts require `complianceVerify(pool, recipient)`.
contract PayoutRouter is ReentrancyGuard {
    using SafeTransfer for address;

    address public immutable deployer;
    address public complianceToken;
    IComplianceValidator public complianceValidator;
    address public compliancePool;
    bool public complianceFrozen;

    mapping(address maker => mapping(bytes32 srcRef => bool)) public done;

    event Payout(
        bytes32 indexed srcRef, address indexed maker, address indexed recipient, address token, uint256 amount, uint8 kind
    );
    event ComplianceConfigured(address indexed token, address indexed validator, address pool);

    /// @param admin the only address allowed to call initCompliance once. Passed explicitly
    ///        (not msg.sender) so a CreateX deployment yields the same address on every chain.
    constructor(address admin) {
        if (admin == address(0)) revert Errors.ZeroAddress();
        deployer = admin;
    }

    /// @notice One-time Cleanverse configuration. Called by the deployer right after deploy,
    ///         or frozen empty with token = address(0). Never changeable afterwards.
    function initCompliance(address token, address validator, address pool) external {
        if (msg.sender != deployer) revert Errors.NotOwner();
        if (complianceFrozen) revert Errors.ComplianceFrozen();
        complianceFrozen = true;
        complianceToken = token;
        complianceValidator = IComplianceValidator(validator);
        compliancePool = pool;
        emit ComplianceConfigured(token, validator, pool);
    }

    /// @notice Pay `amount` of `token` (address(0) = native, send msg.value) to `recipient`
    ///         for source payment `srcRef`.
    function fill(bytes32 srcRef, address recipient, address token, uint256 amount) external payable nonReentrant {
        _pay(srcRef, recipient, token, amount, Kinds.LEAF_PAYOUT_FILL);
    }

    /// @notice Return an unroutable payment (bad ident code, out-of-range amount, inactive pair)
    ///         to its sender on the source chain.
    function refund(bytes32 srcRef, address recipient, address token, uint256 amount) external payable nonReentrant {
        _pay(srcRef, recipient, token, amount, Kinds.LEAF_PAYOUT_REFUND);
    }

    function isCompliant(address token, address recipient) public view returns (bool) {
        if (token == address(0) || token != complianceToken) return true;
        return complianceValidator.complianceVerify(compliancePool, recipient);
    }

    function _pay(bytes32 srcRef, address recipient, address token, uint256 amount, uint8 kind) internal {
        if (recipient == address(0)) revert Errors.ZeroAddress();
        if (done[msg.sender][srcRef]) revert Errors.AlreadyPaid(msg.sender, srcRef);
        if (!isCompliant(token, recipient)) revert Errors.RecipientNotCompliant(recipient);
        done[msg.sender][srcRef] = true;
        if (token == address(0)) {
            if (msg.value != amount) revert Errors.WrongValue(msg.value, amount);
            recipient.sendNative(amount);
        } else {
            if (msg.value != 0) revert Errors.WrongValue(msg.value, 0);
            token.safeTransferFrom(msg.sender, recipient, amount);
        }
        emit Payout(srcRef, msg.sender, recipient, token, amount, kind);
    }
}
