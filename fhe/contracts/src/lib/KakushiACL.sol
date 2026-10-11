// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KakushiErrors} from "./KakushiErrors.sol";

/// @title KakushiACL: who may compute on, and decrypt, each ciphertext handle.
/// @notice Persistent permissions (storage) and per-transaction permissions (EIP-1153 transient
///         storage, which Monad supports). A contract can only grant access to a handle it is itself
///         allowed to use. The executor gives the calling contract transient access to every result
///         it produces, so intermediate values cost no storage; FHE.allowThis persists what is kept.
///         The coprocessor checks this contract before any decryption (user or public).
contract KakushiACL {
    address public immutable executor;

    mapping(bytes32 handle => mapping(address account => bool)) internal _persisted;
    mapping(bytes32 handle => bool) public isAllowedForDecryption;

    event Allowed(bytes32 indexed handle, address indexed account);
    event AllowedForDecryption(bytes32 indexed handle, address indexed by);

    constructor(address executor_) {
        if (executor_ == address(0)) revert KakushiErrors.ZeroAddress();
        executor = executor_;
    }

    function _tslot(bytes32 handle, address account) private pure returns (bytes32) {
        return keccak256(abi.encode("kakushi.fhe.acl.transient", handle, account));
    }

    function _transient(bytes32 handle, address account) internal view returns (bool v) {
        bytes32 s = _tslot(handle, account);
        assembly {
            v := tload(s)
        }
    }

    function _setTransient(bytes32 handle, address account) internal {
        bytes32 s = _tslot(handle, account);
        assembly {
            tstore(s, 1)
        }
    }

    function isAllowed(bytes32 handle, address account) public view returns (bool) {
        return _persisted[handle][account] || _transient(handle, account);
    }

    function persistAllowed(bytes32 handle, address account) external view returns (bool) {
        return _persisted[handle][account];
    }

    /// Grant `account` persistent access. Caller must already have access to `handle`.
    function allow(bytes32 handle, address account) external {
        if (!isAllowed(handle, msg.sender)) revert KakushiErrors.NotAllowed(handle, msg.sender);
        _persisted[handle][account] = true;
        emit Allowed(handle, account);
    }

    /// Grant `account` access for the rest of this transaction only.
    function allowTransient(bytes32 handle, address account) external {
        if (msg.sender != executor && !isAllowed(handle, msg.sender)) revert KakushiErrors.NotAllowed(handle, msg.sender);
        _setTransient(handle, account);
    }

    /// Make handles decryptable by anyone (public reveal). Caller must have access.
    function allowForDecryption(bytes32[] calldata handles) external {
        for (uint256 i; i < handles.length; i++) {
            if (!isAllowed(handles[i], msg.sender)) revert KakushiErrors.NotAllowed(handles[i], msg.sender);
            isAllowedForDecryption[handles[i]] = true;
            emit AllowedForDecryption(handles[i], msg.sender);
        }
    }
}
