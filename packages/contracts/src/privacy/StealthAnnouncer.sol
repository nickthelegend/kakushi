// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC5564Announcer} from "../interfaces/IERC5564Announcer.sol";

/// @notice ERC-5564 announcer singleton. Recipients scan its `Announcement` logs, filter by the
///         view tag in metadata byte 0, then derive the stealth key for matching entries.
///         Permissionless and stateless: anyone may announce anything; receivers verify.
contract StealthAnnouncer is IERC5564Announcer {
    function announce(uint256 schemeId, address stealthAddress, bytes memory ephemeralPubKey, bytes memory metadata)
        external
    {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
