// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KakushiErrors} from "./KakushiErrors.sol";

/// @notice k-of-n EIP-712 signer set (input attesters, KMS decryption signers).
///         TRUST: the owner can rotate the set (documented); signatures are the security boundary.
abstract contract KakushiSigners {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private immutable _nameHash;

    address public owner;
    address[] internal _signers;
    mapping(address => bool) public isSigner;
    uint256 public threshold;

    event SignersSet(address[] signers, uint256 threshold);

    constructor(string memory name_, address owner_, address[] memory signers_, uint256 threshold_) {
        _nameHash = keccak256(bytes(name_));
        owner = owner_;
        _setSigners(signers_, threshold_);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, _nameHash, keccak256("1"), block.chainid, address(this)));
    }

    function signers() external view returns (address[] memory) {
        return _signers;
    }

    function setSigners(address[] calldata signers_, uint256 threshold_) external {
        if (msg.sender != owner) revert KakushiErrors.NotOwner();
        _setSigners(signers_, threshold_);
    }

    function _setSigners(address[] memory signers_, uint256 threshold_) internal {
        for (uint256 i; i < _signers.length; i++) isSigner[_signers[i]] = false;
        if (threshold_ == 0 || threshold_ > signers_.length) revert KakushiErrors.ThresholdNotMet(signers_.length, threshold_);
        for (uint256 i; i < signers_.length; i++) {
            if (signers_[i] == address(0)) revert KakushiErrors.ZeroAddress();
            isSigner[signers_[i]] = true;
        }
        _signers = signers_;
        threshold = threshold_;
        emit SignersSet(signers_, threshold_);
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// Counts distinct valid signers; reverts below threshold.
    function _requireThreshold(bytes32 digest, bytes[] memory sigs) internal view {
        address[] memory seen = new address[](sigs.length);
        uint256 valid;
        for (uint256 i; i < sigs.length; i++) {
            address s = _recover(digest, sigs[i]);
            if (s == address(0) || !isSigner[s]) continue;
            bool dup;
            for (uint256 j; j < valid; j++) if (seen[j] == s) dup = true;
            if (dup) continue;
            seen[valid++] = s;
        }
        if (valid < threshold) revert KakushiErrors.ThresholdNotMet(valid, threshold);
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
