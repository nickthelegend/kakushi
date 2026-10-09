// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6538Registry, IERC1271} from "../interfaces/IERC6538Registry.sol";

/// @notice ERC-6538 stealth meta-address registry. A registrant publishes, per scheme, the
///         stealth meta-address senders derive one-time stealth addresses from (scheme 1:
///         66 bytes = compressed spending pubkey || compressed viewing pubkey).
///         EIP-712 domain: name "ERC6538Registry", version "1.0", chainId, this contract.
contract StealthRegistry is IERC6538Registry {
    bytes32 public constant ERC6538REGISTRY_ENTRY_TYPE_HASH =
        keccak256("Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)");
    bytes32 private constant EIP712_DOMAIN_TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// secp256k1n / 2 (EIP-2 low-s)
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint256 private immutable _initialChainId;
    bytes32 private immutable _initialDomainSeparator;

    mapping(address registrant => mapping(uint256 schemeId => bytes)) private _metaAddress;
    mapping(address registrant => uint256) public nonceOf;

    constructor() {
        _initialChainId = block.chainid;
        _initialDomainSeparator = _domainSeparator();
    }

    function stealthMetaAddressOf(address registrant, uint256 schemeId) external view returns (bytes memory) {
        return _metaAddress[registrant][schemeId];
    }

    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external {
        _metaAddress[msg.sender][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(msg.sender, schemeId, stealthMetaAddress);
    }

    /// @param signature 65-byte (r, s, v) ECDSA signature by `registrant`, or any signature its
    ///        EIP-1271 `isValidSignature` accepts when `registrant` is a contract.
    function registerKeysOnBehalf(
        address registrant,
        uint256 schemeId,
        bytes memory signature,
        bytes calldata stealthMetaAddress
    ) external {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        ERC6538REGISTRY_ENTRY_TYPE_HASH, schemeId, keccak256(stealthMetaAddress), nonceOf[registrant]++
                    )
                )
            )
        );
        if (!_validSignature(registrant, digest, signature)) revert ERC6538Registry__InvalidSignature();
        _metaAddress[registrant][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(registrant, schemeId, stealthMetaAddress);
    }

    /// Invalidates any signature the caller has handed out but not yet used.
    function incrementNonce() external {
        emit NonceIncremented(msg.sender, ++nonceOf[msg.sender]);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _initialChainId ? _initialDomainSeparator : _domainSeparator();
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPE_HASH, keccak256("ERC6538Registry"), keccak256("1.0"), block.chainid, address(this)
            )
        );
    }

    function _validSignature(address signer, bytes32 digest, bytes memory sig) private view returns (bool) {
        if (signer.code.length > 0) {
            (bool ok, bytes memory ret) =
                signer.staticcall(abi.encodeWithSelector(IERC1271.isValidSignature.selector, digest, sig));
            return ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == IERC1271.isValidSignature.selector;
        }
        if (sig.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > HALF_N) return false;
        address recovered = ecrecover(digest, v, r, s);
        return recovered != address(0) && recovered == signer;
    }
}
