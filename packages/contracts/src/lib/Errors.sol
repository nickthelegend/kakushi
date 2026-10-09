// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Every custom error in Kakushi, in one grep-able place.
library Errors {
    // access
    error NotOwner();
    error NotGuardian();
    error NotMaker();
    error NotDisputeModule();
    error NotForwarder(address sender);
    error InvalidWorkflowOwner(address owner);
    error AlreadyConfigured();
    error Paused();
    error ZeroAddress();

    // EBC
    error IdentCodeTaken(uint16 code);
    error InvalidIdentCode(uint16 code);
    error IdentCodeChainMismatch(uint16 code, uint64 expected, uint64 got);
    error PairExists(bytes32 pairId);
    error UnknownPair(bytes32 pairId);
    error TooManyPairs();
    error InvalidParams();
    error MarginConfigMismatch();

    // amounts
    error AmountBelowMin(uint256 amount, uint256 min);
    error AmountAboveMax(uint256 amount, uint256 max);
    error WrongValue(uint256 got, uint256 expected);
    error TransferFailed();

    // routers
    error AlreadyPaid(address maker, bytes32 srcRef);
    error RecipientNotCompliant(address recipient);
    error ComplianceFrozen();

    // MDC
    error InsufficientMargin(uint256 available, uint256 requested);
    error MarginBelowRequired(uint256 remaining, uint256 required);
    error WithdrawLocked(uint64 unlockAt);
    error NoPendingWithdraw();
    error OpenDisputes(uint256 count);
    error StalePrice(uint256 updatedAt);
    error BadPrice();

    // oracle
    error WindowNotContiguous(uint64 chainId, uint64 expectedFrom, uint64 gotFrom);
    error InvalidWindow();
    error UnknownWindow(uint256 id);

    // disputes
    error AlreadyDisputed(bytes32 disputeKey);
    error AlreadySettled(bytes32 disputeKey);
    error DisputeNotOpen(bytes32 disputeKey);
    error DisputeWindowClosed(bytes32 disputeKey);
    error DisputeWindowOpen(bytes32 disputeKey);
    error DeadlineNotReached(uint64 deadline);
    error NoObligation();
    error WrongWindowChain(uint256 windowId, uint64 expected, uint64 got);
    error WrongWindowKind(uint256 windowId);
    error WindowsDoNotCover();
    error TooManyWindows();
    error InvalidProof();
    error MakerMismatch();

    // privacy (stealth payments + shielded pools)
    error InvalidStealthAddress();
    error InvalidEphemeralPubKey();
    error ZeroAmount();
    error NotAFieldElement();
    error CommitmentExists(bytes32 commitment);
    error TreeFull();
    error UnknownRoot(bytes32 root);
    error NullifierSpent(bytes32 nullifierHash);
    error FeeTooHigh(uint256 fee, uint256 denomination);
    error InvalidRecipient();
}
