// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Errors} from "./lib/Errors.sol";
import {Kinds} from "./lib/Kinds.sol";
import {IReceiver, IERC165} from "./interfaces/IReceiver.sol";

/// @title AttestationOracle: Chainlink CRE consumer on the Monad hub.
/// @notice Stores Poseidon2 Merkle roots of normalized source payments and Maker payouts,
///         posted by the `kakushi-attest` CRE workflow through the Chainlink forwarder.
///
///         PAYOUT windows must be block-contiguous per chain (fromBlock == previous toBlock + 1).
///         That is what makes an absence proof sound: a window cannot silently skip blocks,
///         and every PayoutRouter `Payout` log in the range is a leaf of the window's sorted tree.
///         SOURCE windows only need to exist (the circuit proves inclusion, never absence).
///
///         The forwarder and the expected workflow owner are fixed at construction, so no
///         admin can later point the oracle at a different reporter.
///
///         DEMO ASSUMPTION: on local forks and in `cre workflow simulate`, the forwarder is
///         Chainlink's MockKeystoneForwarder, which does not check DON signatures; anyone can
///         post through it. Production uses the KeystoneForwarder, which verifies the DON's
///         signatures, and a deployed workflow whose owner is pinned in `expectedOwner`.
contract AttestationOracle is IReceiver, IERC165 {
    struct Window {
        uint64 chainId;
        uint8 kind; // Kinds.WINDOW_SOURCE / WINDOW_PAYOUT
        uint64 fromBlock;
        uint64 toBlock;
        uint64 fromTime;
        uint64 toTime;
        uint256 root;
        uint32 leafCount;
    }

    address public immutable forwarder;
    /// @notice expected CRE workflow owner; zero disables the check (local/simulate only)
    address public immutable expectedOwner;

    Window[] internal _windows; // id = index + 1

    mapping(uint64 chainId => uint64) public lastPayoutToBlock;
    mapping(uint64 chainId => uint256) public lastPayoutWindowId;
    mapping(uint64 chainId => uint256) public lastSourceWindowId;

    event WindowAttested(
        uint256 indexed id,
        uint64 indexed chainId,
        uint8 indexed kind,
        uint64 fromBlock,
        uint64 toBlock,
        uint64 fromTime,
        uint64 toTime,
        uint256 root,
        uint32 leafCount
    );

    constructor(address forwarder_, address expectedOwner_) {
        if (forwarder_ == address(0)) revert Errors.ZeroAddress();
        forwarder = forwarder_;
        expectedOwner = expectedOwner_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice report = abi.encode(Window[]). metadata = workflowId(32) | name(10) | owner(20) | reportId(2).
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert Errors.NotForwarder(msg.sender);
        if (expectedOwner != address(0)) {
            address owner_;
            if (metadata.length >= 62) owner_ = address(bytes20(metadata[42:62]));
            if (owner_ != expectedOwner) revert Errors.InvalidWorkflowOwner(owner_);
        }
        Window[] memory ws = abi.decode(report, (Window[]));
        for (uint256 i; i < ws.length; i++) {
            _record(ws[i]);
        }
    }

    function _record(Window memory w) internal {
        if (w.chainId == 0 || w.toBlock < w.fromBlock || w.toTime < w.fromTime || w.root == 0) {
            revert Errors.InvalidWindow();
        }
        if (w.kind == Kinds.WINDOW_PAYOUT) {
            uint256 prevId = lastPayoutWindowId[w.chainId];
            if (prevId != 0) {
                uint64 expectedFrom = lastPayoutToBlock[w.chainId] + 1;
                if (w.fromBlock != expectedFrom) revert Errors.WindowNotContiguous(w.chainId, expectedFrom, w.fromBlock);
            }
            _windows.push(w);
            lastPayoutToBlock[w.chainId] = w.toBlock;
            lastPayoutWindowId[w.chainId] = _windows.length;
        } else if (w.kind == Kinds.WINDOW_SOURCE) {
            _windows.push(w);
            lastSourceWindowId[w.chainId] = _windows.length;
        } else {
            revert Errors.InvalidWindow();
        }
        emit WindowAttested(_windows.length, w.chainId, w.kind, w.fromBlock, w.toBlock, w.fromTime, w.toTime, w.root, w.leafCount);
    }

    // ------------------------------------------------------------------ views

    function windowCount() external view returns (uint256) {
        return _windows.length;
    }

    function getWindow(uint256 id) public view returns (Window memory) {
        if (id == 0 || id > _windows.length) revert Errors.UnknownWindow(id);
        return _windows[id - 1];
    }

    /// @notice Latest attested payout time for a chain (0 if none), for "is it disputable yet?".
    function payoutCoveredUntil(uint64 chainId) external view returns (uint64) {
        uint256 id = lastPayoutWindowId[chainId];
        return id == 0 ? 0 : _windows[id - 1].toTime;
    }
}
