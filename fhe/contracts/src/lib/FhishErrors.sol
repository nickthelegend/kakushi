// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library FhishErrors {
    error NotAllowed(bytes32 handle, address account);
    error NotExecutor();
    error NotOwner();
    error TypeMismatch(uint8 expected, uint8 got);
    error InvalidInputProof();
    error InputNotForCaller();
    error ThresholdNotMet(uint256 valid, uint256 threshold);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error LengthMismatch();
    error NotForwarder(address sender);
    error FhishNotConfigured();
    error ZeroAddress();
}
