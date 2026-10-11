// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KakushiACL} from "../lib/KakushiACL.sol";
import {KakushiErrors} from "../lib/KakushiErrors.sol";
import {KakushiSigners} from "../lib/KakushiSigners.sol";

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title KakushiDecryptionOracle: public decryption with callbacks.
/// @notice A contract asks for some of its handles to be revealed (e.g. the auction's winning bid).
///         The KMS signers (k-of-n) check the request on-chain, decrypt, and sign an EIP-712
///         DecryptionResult. The result is delivered either directly (`fulfill`) or by a Chainlink CRE
///         workflow through the KeystoneForwarder (`onReport`): CRE is the orchestration layer that
///         watches requests, fetches the signed results with DON consensus and pays the gas. Either way
///         the KMS signatures are verified here, so neither path can forge a cleartext.
contract KakushiDecryptionOracle is KakushiSigners, IReceiver {
    bytes32 public constant RESULT_TYPEHASH =
        keccak256("DecryptionResult(uint256 requestId,bytes32 handlesHash,bytes32 cleartextsHash)");

    struct Request {
        address requester;
        bytes4 callback;
        bool fulfilled;
        bytes32 handlesHash;
    }

    KakushiACL public immutable acl;
    /// Chainlink CRE forwarder allowed to deliver reports (zero disables the CRE path)
    address public immutable forwarder;

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;
    mapping(uint256 => bytes32[]) internal _handles;

    event DecryptionRequested(uint256 indexed requestId, address indexed requester, bytes32[] handles, bytes4 callback);
    event DecryptionFulfilled(uint256 indexed requestId, uint256[] cleartexts, bool callbackOk, address via);

    constructor(KakushiACL acl_, address forwarder_, address owner_, address[] memory signers_, uint256 threshold_)
        KakushiSigners("KakushiDecryptionOracle", owner_, signers_, threshold_)
    {
        acl = acl_;
        forwarder = forwarder_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IReceiver).interfaceId || id == 0x01ffc9a7;
    }

    function handlesOf(uint256 requestId) external view returns (bytes32[] memory) {
        return _handles[requestId];
    }

    /// Request public decryption of handles the caller may use. The callback receives
    /// (uint256 requestId, uint256[] cleartexts).
    function requestDecryption(bytes32[] calldata handles, bytes4 callback) external returns (uint256 id) {
        for (uint256 i; i < handles.length; i++) {
            if (!acl.isAllowed(handles[i], msg.sender)) revert KakushiErrors.NotAllowed(handles[i], msg.sender);
        }
        id = nextRequestId++;
        requests[id] = Request(msg.sender, callback, false, keccak256(abi.encodePacked(handles)));
        _handles[id] = handles;
        emit DecryptionRequested(id, msg.sender, handles, callback);
    }

    function resultDigest(uint256 requestId, uint256[] calldata cleartexts) public view returns (bytes32) {
        return _digest(
            keccak256(abi.encode(RESULT_TYPEHASH, requestId, requests[requestId].handlesHash, keccak256(abi.encodePacked(cleartexts))))
        );
    }

    function fulfill(uint256 requestId, uint256[] calldata cleartexts, bytes[] calldata signatures) external {
        _fulfill(requestId, cleartexts, signatures, msg.sender);
    }

    /// CRE delivery: report = abi.encode(uint256 requestId, uint256[] cleartexts, bytes[] signatures)
    function onReport(bytes calldata, bytes calldata report) external {
        if (forwarder == address(0) || msg.sender != forwarder) revert KakushiErrors.NotForwarder(msg.sender);
        (uint256 requestId, uint256[] memory cleartexts, bytes[] memory signatures) = abi.decode(report, (uint256, uint256[], bytes[]));
        this.fulfillFromReport(requestId, cleartexts, signatures);
    }

    /// external hop so calldata types line up; only callable by this contract
    function fulfillFromReport(uint256 requestId, uint256[] calldata cleartexts, bytes[] calldata signatures) external {
        if (msg.sender != address(this)) revert KakushiErrors.NotForwarder(msg.sender);
        _fulfill(requestId, cleartexts, signatures, forwarder);
    }

    function _fulfill(uint256 requestId, uint256[] calldata cleartexts, bytes[] calldata signatures, address via) internal {
        Request storage r = requests[requestId];
        if (r.requester == address(0)) revert KakushiErrors.UnknownRequest(requestId);
        if (r.fulfilled) revert KakushiErrors.AlreadyFulfilled(requestId);
        if (cleartexts.length != _handles[requestId].length) revert KakushiErrors.LengthMismatch();
        _requireThreshold(resultDigest(requestId, cleartexts), signatures);
        r.fulfilled = true;
        (bool ok,) = r.requester.call(abi.encodeWithSelector(r.callback, requestId, cleartexts));
        emit DecryptionFulfilled(requestId, cleartexts, ok, via);
    }
}
