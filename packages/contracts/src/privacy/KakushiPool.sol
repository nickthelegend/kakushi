// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {IRootOracle} from "../interfaces/IRootOracle.sol";
import {IERC20Min} from "../interfaces/IERC20Min.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";
import {SafeTransfer} from "../lib/SafeTransfer.sol";
import {Errors} from "../lib/Errors.sol";
import {Poseidon2} from "../lib/Poseidon2.sol";
import {PoolZeros} from "./PoolZeros.sol";
import {PrivateCallExecutor} from "./PrivateCallExecutor.sol";

/// @notice Fixed-denomination shielded pool (Tornado / Privacy Pools style). One instance per
///         (token, denomination); token == address(0) is the chain's native coin.
///
///         Note    : (nullifier, secret), random BN254 field elements
///         Leaf    : commitment    = Poseidon2::hash([nullifier, secret], 2)
///         Spend   : nullifierHash = Poseidon2::hash([nullifier], 1)
///         Tree    : incremental, depth 20, node = Poseidon2::hash([left, right], 2), empty leaf
///                   PoolZeros.ZERO_VALUE; the last 64 roots are accepted.
///         Proof   : packages/zk/circuits/shielded_withdraw (UltraHonk, keccak transcript, ZK) with
///                   public inputs, as bytes32 field elements in this order:
///                   [root, nullifierHash, uint160(recipient), uint160(relayer), fee, refund,
///                    block.chainid, uint160(address(this)), extDataHash]
///                   so a proof is bound to one recipient/relayer/fee/refund, one chain and one pool.
///         Private call (withdrawAndCall): recipient = this pool's `executor`, refund = 0 and
///                   extDataHash = uint256(keccak256(abi.encode(address target, bytes data,
///                                 address refundTo, uint256 block.chainid, address(this)))) % p
///                   (see extDataHash()); a plain withdrawal binds extDataHash = 0.
contract KakushiPool is ReentrancyGuard {
    using SafeTransfer for address;

    uint256 public constant FIELD_SIZE = Poseidon2.P;
    uint256 public constant LEVELS = 20; // == PoolZeros.DEPTH (asserted in the constructor)
    uint256 public constant ROOT_HISTORY_SIZE = 64;

    IVerifier public immutable verifier;
    /// address(0) = native coin
    address public immutable token;
    uint256 public immutable denomination;
    /// cross-chain hook, address(0) in every deployment today (see IRootOracle)
    IRootOracle public immutable rootOracle;
    /// runs private calls; deployed here, so its address is CREATE(address(this), nonce 1)
    PrivateCallExecutor public immutable executor;

    uint256[LEVELS] public filledSubtrees;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public nullifierHashes;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);
    /// emitted after Withdrawal(executor, ...) by withdrawAndCall
    event PrivateCall(
        bytes32 indexed nullifierHash,
        address indexed target,
        address refundTo,
        uint256 amount,
        uint256 refundedToken,
        uint256 refundedNative
    );

    constructor(IVerifier verifier_, address token_, uint256 denomination_, IRootOracle rootOracle_) {
        if (address(verifier_) == address(0)) revert Errors.ZeroAddress();
        if (denomination_ == 0 || denomination_ >= 2 ** 128) revert Errors.InvalidParams();
        if (token_ != address(0) && token_.code.length == 0) revert Errors.InvalidParams();
        assert(LEVELS == PoolZeros.DEPTH);
        verifier = verifier_;
        token = token_;
        denomination = denomination_;
        rootOracle = rootOracle_;
        executor = new PrivateCallExecutor();
        for (uint256 i; i < LEVELS; i++) {
            filledSubtrees[i] = PoolZeros.zeros(i);
        }
        roots[0] = bytes32(PoolZeros.zeros(LEVELS));
    }

    // ------------------------------------------------------------------ deposit

    /// @notice Deposit exactly `denomination` (msg.value for native pools, transferFrom with prior
    ///         approval for ERC-20 pools) behind `commitment`.
    function deposit(bytes32 commitment) external payable nonReentrant {
        if (uint256(commitment) >= FIELD_SIZE) revert Errors.NotAFieldElement();
        if (commitments[commitment]) revert Errors.CommitmentExists(commitment);
        commitments[commitment] = true;
        uint32 leafIndex = _insert(uint256(commitment));

        if (token == address(0)) {
            if (msg.value != denomination) revert Errors.WrongValue(msg.value, denomination);
        } else {
            if (msg.value != 0) revert Errors.WrongValue(msg.value, 0);
            uint256 before = IERC20Min(token).balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), denomination);
            uint256 received = IERC20Min(token).balanceOf(address(this)) - before;
            if (received != denomination) revert Errors.WrongValue(received, denomination);
        }
        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    // ------------------------------------------------------------------ withdraw

    /// @notice Spend a note: pays `denomination - fee` to `recipient` and `fee` to `relayer`.
    ///         ERC-20 pools: the relayer may attach `refund` wei (msg.value == refund), forwarded
    ///         to the recipient as gas money. Native pools: refund must be 0.
    function withdraw(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 refund
    ) external payable nonReentrant {
        if (recipient == address(executor)) revert Errors.InvalidRecipient();
        _spend(proof, root, nullifierHash, recipient, relayer, fee, refund, 0);

        if (token == address(0)) {
            address(recipient).sendNative(denomination - fee);
            if (fee > 0) address(relayer).sendNative(fee);
        } else {
            token.safeTransfer(recipient, denomination - fee);
            if (fee > 0) token.safeTransfer(relayer, fee);
            if (refund > 0) {
                (bool ok,) = recipient.call{value: refund}("");
                // a recipient that rejects coin must not block the withdrawal: refund the relayer
                if (!ok) address(relayer).sendNative(refund);
            }
        }
        emit Withdrawal(recipient, nullifierHash, relayer, fee);
    }

    // ------------------------------------------------------------------ private call

    /// @notice Spend a note INTO a contract call ("any contract call -> private"): pays `fee` to
    ///         `relayer`, then this pool's executor calls `target` with `data` carrying
    ///         `denomination - fee` (as msg.value for native pools, as an allowance for ERC-20
    ///         pools, reset to 0 afterwards). Whatever the executor holds of the pool asset or the
    ///         native coin after the call is sent to `refundTo`. target, data and refundTo are bound
    ///         by the proof through extDataHash, so a relayer can change none of them. If the call
    ///         reverts, the whole withdrawal reverts and the note stays unspent.
    ///         target must be a contract other than this pool, its executor and the pool token.
    function withdrawAndCall(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifierHash,
        address payable relayer,
        uint256 fee,
        address target,
        bytes calldata data,
        address refundTo
    ) external nonReentrant {
        if (refundTo == address(0)) revert Errors.InvalidRecipient();
        if (target.code.length == 0 || target == address(this) || target == address(executor) || target == token) {
            revert Errors.InvalidCallTarget(target);
        }
        _spend(proof, root, nullifierHash, address(executor), relayer, fee, 0, extDataHash(target, data, refundTo));

        uint256 amount = denomination - fee;
        uint256 refundedToken;
        uint256 refundedNative;
        if (token == address(0)) {
            if (fee > 0) address(relayer).sendNative(fee);
            (refundedToken, refundedNative) =
                executor.execute{value: amount}(address(0), amount, target, data, refundTo);
        } else {
            if (fee > 0) token.safeTransfer(relayer, fee);
            token.safeTransfer(address(executor), amount);
            (refundedToken, refundedNative) = executor.execute(token, amount, target, data, refundTo);
        }
        emit Withdrawal(address(executor), nullifierHash, relayer, fee);
        emit PrivateCall(nullifierHash, target, refundTo, amount, refundedToken, refundedNative);
    }

    /// @notice The private-call binding: uint256(keccak256(abi.encode(target, data, refundTo,
    ///         block.chainid, address(this)))) mod p (BN254 scalar field), never 0 in practice.
    function extDataHash(address target, bytes calldata data, address refundTo) public view returns (uint256) {
        return uint256(keccak256(abi.encode(target, data, refundTo, block.chainid, address(this)))) % FIELD_SIZE;
    }

    /// @notice The verifier's public inputs for a private call from this pool on this chain.
    function callPublicInputs(
        bytes32 root,
        bytes32 nullifierHash,
        address relayer,
        uint256 fee,
        address target,
        bytes calldata data,
        address refundTo
    ) external view returns (bytes32[] memory) {
        return _publicInputs(root, nullifierHash, address(executor), relayer, fee, 0, extDataHash(target, data, refundTo));
    }

    // ------------------------------------------------------------------ spend

    /// checks, proof verification and nullifier burn shared by withdraw and withdrawAndCall
    function _spend(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256 refund,
        uint256 extHash
    ) internal {
        if (fee > denomination) revert Errors.FeeTooHigh(fee, denomination);
        if (recipient == address(0) || (fee > 0 && relayer == address(0))) revert Errors.InvalidRecipient();
        if (uint256(nullifierHash) >= FIELD_SIZE) revert Errors.NotAFieldElement();
        if (nullifierHashes[nullifierHash]) revert Errors.NullifierSpent(nullifierHash);
        if (!isKnownRoot(root)) {
            if (address(rootOracle) == address(0) || !rootOracle.isKnownRoot(address(this), root)) {
                revert Errors.UnknownRoot(root);
            }
        }
        if (token == address(0)) {
            if (msg.value != 0 || refund != 0) revert Errors.WrongValue(msg.value, 0);
        } else if (msg.value != refund) {
            revert Errors.WrongValue(msg.value, refund);
        }

        // the bb verifiers revert (rather than return false) on most failures: normalise both
        try verifier.verify(proof, _publicInputs(root, nullifierHash, recipient, relayer, fee, refund, extHash)) returns (
            bool ok
        ) {
            if (!ok) revert Errors.InvalidProof();
        } catch {
            revert Errors.InvalidProof();
        }
        nullifierHashes[nullifierHash] = true;
    }

    /// @notice The verifier's public inputs for a plain withdrawal (extDataHash = 0) from this pool on this chain.
    function publicInputs(
        bytes32 root,
        bytes32 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256 refund
    ) public view returns (bytes32[] memory) {
        return _publicInputs(root, nullifierHash, recipient, relayer, fee, refund, 0);
    }

    function _publicInputs(
        bytes32 root,
        bytes32 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256 refund,
        uint256 extHash
    ) internal view returns (bytes32[] memory pi) {
        pi = new bytes32[](9);
        pi[0] = root;
        pi[1] = nullifierHash;
        pi[2] = bytes32(uint256(uint160(recipient)));
        pi[3] = bytes32(uint256(uint160(relayer)));
        pi[4] = bytes32(fee);
        pi[5] = bytes32(refund);
        pi[6] = bytes32(block.chainid);
        pi[7] = bytes32(uint256(uint160(address(this))));
        pi[8] = bytes32(extHash);
    }

    // ------------------------------------------------------------------ tree

    function _insert(uint256 leaf) internal returns (uint32 index) {
        uint32 next = nextIndex;
        if (next == uint32(1) << uint32(LEVELS)) revert Errors.TreeFull();
        uint256 cur = leaf;
        uint256 idx = next;
        for (uint256 i; i < LEVELS; i++) {
            if (idx & 1 == 0) {
                filledSubtrees[i] = cur;
                cur = Poseidon2.hash2(cur, PoolZeros.zeros(i));
            } else {
                cur = Poseidon2.hash2(filledSubtrees[i], cur);
            }
            idx >>= 1;
        }
        uint32 newRootIndex = uint32((currentRootIndex + 1) % ROOT_HISTORY_SIZE);
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = bytes32(cur);
        nextIndex = next + 1;
        return next;
    }

    /// @notice True if `root` is one of the last ROOT_HISTORY_SIZE roots of this pool.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        uint256 i = currentRootIndex;
        for (uint256 n; n < ROOT_HISTORY_SIZE; n++) {
            if (roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        }
        return false;
    }

    function getLastRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return nullifierHashes[nullifierHash];
    }
}
