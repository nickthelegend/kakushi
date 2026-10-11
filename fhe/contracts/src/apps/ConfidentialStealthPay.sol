// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {euint64, externalEuint64} from "../lib/KakushiTypes.sol";

interface IConfidentialTransferFrom {
    function confidentialTransferFrom(address from, address to, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        returns (euint64);
}

interface IERC5564AnnouncerLike {
    function announce(uint256 schemeId, address stealthAddress, bytes memory ephemeralPubKey, bytes memory metadata) external;
}

/// @title ConfidentialStealthPay: hide who AND how much, in one transaction.
/// @notice Kakushi's two engines together. The amount is an FHE ciphertext (a confidential token such
///         as KakushiPayToken moves it homomorphically) and the recipient is an ERC-5564 stealth
///         address (a fresh one-time address only the recipient's viewing key can link to them).
///
///         `pay` moves the caller's encrypted amount to the stealth address, forwards any msg.value to
///         it as gas (so it can move the funds on later), and announces the payment on Kakushi's
///         ERC-5564 announcer with FHE metadata (57 bytes, the ERC-5564 recommended layout):
///           [0]      view tag
///           [1..4]   0xfe0000fe (FHE_SELECTOR: "confidential amount")
///           [5..24]  the confidential token
///           [25..56] the euint64 handle of the amount actually moved (a ciphertext, never a number);
///                    the token grants the stealth address the right to decrypt it
///
///         Setup, once per holder: `token.setOperator(address(this), until)`. Spending is always from
///         msg.sender, so the operator right only lets a holder pay from their own balance. The
///         encrypted amount is bound to (user = this contract, contract = token), because the token
///         sees this contract as its caller.
contract ConfidentialStealthPay {
    uint256 public constant SCHEME_SECP256K1 = 1;
    bytes4 public constant FHE_SELECTOR = 0xfe0000fe;

    IERC5564AnnouncerLike public immutable announcer;

    error ZeroAddress();
    error InvalidEphemeralPubKey();
    error GasForwardFailed();

    constructor(IERC5564AnnouncerLike announcer_) {
        if (address(announcer_) == address(0)) revert ZeroAddress();
        announcer = announcer_;
    }

    /// The one-time recipient: ERC-5564 stealth address, its ephemeral public key (33 B compressed)
    /// and view tag (metadata byte 0), as returned by @kakushi/sdk generateStealthAddress.
    struct StealthRecipient {
        address stealthAddress;
        bytes ephemeralPubKey;
        bytes1 viewTag;
    }

    function pay(address token, StealthRecipient calldata to, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        payable
        returns (euint64 sent)
    {
        _check(token, to);
        sent = IConfidentialTransferFrom(token).confidentialTransferFrom(msg.sender, to.stealthAddress, encryptedAmount, inputProof);
        if (msg.value > 0) {
            (bool ok,) = to.stealthAddress.call{value: msg.value}("");
            if (!ok) revert GasForwardFailed();
        }
        _announce(to, token, sent);
    }

    function _check(address token, StealthRecipient calldata to) private pure {
        if (token == address(0) || to.stealthAddress == address(0)) revert ZeroAddress();
        bytes calldata eph = to.ephemeralPubKey;
        if (eph.length != 33 || (eph[0] != 0x02 && eph[0] != 0x03)) revert InvalidEphemeralPubKey();
    }

    function _announce(StealthRecipient calldata to, address token, euint64 sent) private {
        announcer.announce(SCHEME_SECP256K1, to.stealthAddress, to.ephemeralPubKey, metadataFor(to.viewTag, token, sent));
    }

    /// The 57-byte announcement metadata for an encrypted amount `sent` of `token`.
    function metadataFor(bytes1 viewTag, address token, euint64 sent) public pure returns (bytes memory) {
        return abi.encodePacked(viewTag, FHE_SELECTOR, token, euint64.unwrap(sent));
    }
}
