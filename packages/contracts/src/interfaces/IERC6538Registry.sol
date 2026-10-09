// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ERC-6538 stealth meta-address registry (https://eips.ethereum.org/EIPS/eip-6538).
interface IERC6538Registry {
    error ERC6538Registry__InvalidSignature();

    event StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress);
    event NonceIncremented(address indexed registrant, uint256 newNonce);

    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external;

    function registerKeysOnBehalf(
        address registrant,
        uint256 schemeId,
        bytes memory signature,
        bytes calldata stealthMetaAddress
    ) external;

    function incrementNonce() external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function ERC6538REGISTRY_ENTRY_TYPE_HASH() external view returns (bytes32);

    function stealthMetaAddressOf(address registrant, uint256 schemeId) external view returns (bytes memory);

    function nonceOf(address registrant) external view returns (uint256);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
}
