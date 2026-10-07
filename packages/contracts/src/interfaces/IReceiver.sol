// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Chainlink CRE consumer interface (same selector as chainlink-evm IReceiver).
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
