// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KakushiACL} from "./KakushiACL.sol";
import {KakushiErrors} from "./KakushiErrors.sol";
import {KakushiType} from "./KakushiTypes.sol";
import {IKakushiInputVerifier} from "./KakushiInputVerifier.sol";

/// @title KakushiExecutor: the symbolic FHE executor on Monad.
/// @notice No FHE math happens on-chain. Each operation checks the ACL (the calling contract must be
///         allowed to use every encrypted operand), derives a deterministic typed result handle, gives
///         the caller transient access to it, and emits an event. The off-chain Kakushi coprocessor
///         replays these events in order with real Zama tfhe-rs ciphertexts. Monad's 300 ms blocks and
///         ~600 ms finality are what make the round trip (op -> ciphertext -> decryption) fast.
///
///         Result handle = keccak256(tag ‖ inputs ‖ chainid ‖ executor)[0..31] ‖ resultType.
contract KakushiExecutor {
    // opcodes (identical in kakushi-fhe-engine)
    uint8 internal constant ADD = 1;
    uint8 internal constant SUB = 2;
    uint8 internal constant MUL = 3;
    uint8 internal constant AND = 6;
    uint8 internal constant OR = 7;
    uint8 internal constant XOR = 8;
    uint8 internal constant SHL = 9;
    uint8 internal constant SHR = 10;
    uint8 internal constant EQ = 13;
    uint8 internal constant NE = 14;
    uint8 internal constant GE = 15;
    uint8 internal constant GT = 16;
    uint8 internal constant LE = 17;
    uint8 internal constant LT = 18;
    uint8 internal constant MIN = 19;
    uint8 internal constant MAX = 20;
    uint8 internal constant NOT = 22;

    KakushiACL public immutable acl;
    IKakushiInputVerifier public immutable inputVerifier;
    uint256 public randNonce;

    event FheOp(uint8 indexed op, bytes32 result, bytes32 lhs, bytes32 rhs, bool scalar, address indexed caller);
    event FheSelect(bytes32 result, bytes32 control, bytes32 ifTrue, bytes32 ifFalse, address indexed caller);
    event TrivialEncrypt(bytes32 result, uint256 value, uint8 toType);
    event VerifyInput(bytes32 result, bytes32 inputHandle, address indexed user, address indexed caller);
    event Rand(bytes32 result, uint256 upperBound, bytes32 seed, uint8 randType);

    constructor(IKakushiInputVerifier inputVerifier_) {
        inputVerifier = inputVerifier_;
        acl = new KakushiACL(address(this));
    }

    function _handle(bytes memory pre, uint8 t) internal view returns (bytes32) {
        bytes32 h = keccak256(abi.encodePacked(pre, block.chainid, address(this)));
        return bytes32((uint256(h) & ~uint256(0xff)) | uint256(t));
    }

    function _use(bytes32 h) internal view {
        if (!acl.isAllowed(h, msg.sender)) revert KakushiErrors.NotAllowed(h, msg.sender);
    }

    function _out(bytes32 r) internal {
        acl.allowTransient(r, msg.sender);
    }

    function _isCmp(uint8 op) internal pure returns (bool) {
        return op >= EQ && op <= LT;
    }

    /// Binary op. If `scalar`, `rhs` is a plaintext constant (right-aligned in the 32 bytes).
    function binary(uint8 op, bytes32 lhs, bytes32 rhs, bool scalar) external returns (bytes32 r) {
        _use(lhs);
        uint8 t = KakushiType.typeOf(lhs);
        if (!scalar) {
            _use(rhs);
            if (KakushiType.typeOf(rhs) != t) revert KakushiErrors.TypeMismatch(t, KakushiType.typeOf(rhs));
        }
        uint8 rt = _isCmp(op) ? KakushiType.EBOOL : t;
        r = _handle(abi.encodePacked("OP", op, lhs, rhs, scalar), rt);
        _out(r);
        emit FheOp(op, r, lhs, rhs, scalar, msg.sender);
    }

    function not(bytes32 ct) external returns (bytes32 r) {
        _use(ct);
        r = _handle(abi.encodePacked("OP", NOT, ct), KakushiType.typeOf(ct));
        _out(r);
        emit FheOp(NOT, r, ct, bytes32(0), false, msg.sender);
    }

    function select(bytes32 control, bytes32 ifTrue, bytes32 ifFalse) external returns (bytes32 r) {
        _use(control);
        _use(ifTrue);
        _use(ifFalse);
        if (KakushiType.typeOf(control) != KakushiType.EBOOL) revert KakushiErrors.TypeMismatch(KakushiType.EBOOL, KakushiType.typeOf(control));
        uint8 t = KakushiType.typeOf(ifTrue);
        if (KakushiType.typeOf(ifFalse) != t) revert KakushiErrors.TypeMismatch(t, KakushiType.typeOf(ifFalse));
        r = _handle(abi.encodePacked("SELECT", control, ifTrue, ifFalse), t);
        _out(r);
        emit FheSelect(r, control, ifTrue, ifFalse, msg.sender);
    }

    /// Encrypt a public constant (no privacy: the value is in the event).
    function trivialEncrypt(uint256 value, uint8 toType) external returns (bytes32 r) {
        r = _handle(abi.encodePacked("TRIVIAL", value, toType), toType);
        _out(r);
        emit TrivialEncrypt(r, value, toType);
    }

    /// Bind a client-encrypted input. The proof is a threshold attestation from the coprocessor's
    /// input signers that the ciphertext behind `inputHandle` is well-formed and was uploaded by
    /// `user` for this calling contract on this chain (KakushiInputVerifier).
    function verifyInput(bytes32 inputHandle, address user, bytes calldata proof, uint8 expectedType)
        external
        returns (bytes32 r)
    {
        if (KakushiType.typeOf(inputHandle) != expectedType) revert KakushiErrors.TypeMismatch(expectedType, KakushiType.typeOf(inputHandle));
        inputVerifier.verify(inputHandle, user, msg.sender, proof);
        r = _handle(abi.encodePacked("INPUT", inputHandle, user, msg.sender), expectedType);
        _out(r);
        emit VerifyInput(r, inputHandle, user, msg.sender);
    }

    /// Encrypted randomness, bounded. DEMO ASSUMPTION: the coprocessor derives the value from the
    /// seed (so it learns it); production uses tfhe's oblivious pseudo-random generation.
    function rand(uint256 upperBound, uint8 randType) external returns (bytes32 r) {
        uint256 n = ++randNonce;
        bytes32 seed = keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, msg.sender, n));
        r = _handle(abi.encodePacked("RAND", seed, upperBound), randType);
        _out(r);
        emit Rand(r, upperBound, seed, randType);
    }
}
