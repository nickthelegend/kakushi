// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ERC-5564 stealth address announcer (https://eips.ethereum.org/EIPS/eip-5564).
interface IERC5564Announcer {
    /// @param schemeId 1 = SECP256k1 with view tags.
    /// @param stealthAddress the computed stealth address of the recipient.
    /// @param caller the account that called announce (the sender, or a helper such as StealthPay).
    /// @param ephemeralPubKey the sender's ephemeral public key (33-byte compressed for scheme 1).
    /// @param metadata byte 0 = view tag; for transfers bytes 1-4 = selector (0xeeeeeeee native,
    ///        0x23b872dd ERC-20 transferFrom), 5-24 = token (0xEeee...EEeE native), 25-56 = amount.
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function announce(uint256 schemeId, address stealthAddress, bytes memory ephemeralPubKey, bytes memory metadata)
        external;
}
