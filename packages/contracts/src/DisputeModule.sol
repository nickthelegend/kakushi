// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Errors} from "./lib/Errors.sol";
import {Kinds} from "./lib/Kinds.sol";
import {SrcRef} from "./lib/SrcRef.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {EBC} from "./EBC.sol";
import {MDC} from "./MDC.sol";
import {AttestationOracle} from "./AttestationOracle.sol";

/// @title DisputeModule: ZK-SPV arbitration on the Monad hub.
/// @notice A dispute names a source payment (srcChainId, txHash, logIndex) and a Maker.
///         - `openDispute` (anyone, bond in native MON) once the fill deadline has passed.
///         - `proveDispute` (anyone): a PaymentCompliance proof that the attested source payment
///           exists and that no compliant payout exists in the attested, contiguous payout
///           windows covering [srcTime - skew, deadline]. Atomically slashes the Maker's margin
///           to the proven sender; the bond goes back to the opener plus a reward from margin.
///         - `answerDispute` (anyone, normally the Maker): a PayoutInclusion proof that the
///           Maker paid correctly. The bond goes to the Maker (anti-grief).
///         - `expire` after the dispute window with no proof: the bond goes to the Maker and
///           the payment may be disputed again.
///
///         Claim fields (sender, recipient, gross, timestamp, token) are supplied at proof time
///         and are bound by the circuit to the CRE-attested source leaf, so a griefer cannot
///         make a false claim stick, and anyone can prove an open dispute with the true facts.
///
///         Solidity checks the metadata (rules at source time via EBC.classify, which windows
///         cover the deadline, chain ids, domain); the circuit checks the contents.
///         Spec states Open -> Challenged -> Proven collapse into one atomic verify + slash.
contract DisputeModule is ReentrancyGuard {
    using SafeTransfer for address;

    enum Status {
        None,
        Open,
        MakerProven,
        Slashed,
        Expired
    }

    struct Dispute {
        address opener;
        address maker;
        uint64 openedAt;
        Status status;
        uint128 bond;
        bytes32 srcRef;
    }

    /// @notice Facts about the source payment; bound by the proof to the attested leaf.
    struct Claim {
        uint64 srcChainId;
        bytes32 srcTxHash;
        uint32 logIndex;
        address maker;
        address sender;
        address recipient; // destination recipient (FILL); ignored for REFUND (sender is paid)
        address srcToken;
        uint256 gross;
        uint64 srcTimestamp;
        uint256 srcWindowId;
    }

    uint256 public constant MAX_WINDOWS = 8;
    uint256 public constant COMPLIANCE_INPUTS = 27;
    uint256 public constant INCLUSION_INPUTS = 19;
    uint256 public constant BPS = 10_000;

    EBC public immutable ebc;
    MDC public immutable mdc;
    AttestationOracle public immutable oracle;
    IVerifier public immutable complianceVerifier;
    IVerifier public immutable inclusionVerifier;

    uint256 public immutable bondAmount;
    uint64 public immutable fillWindow;
    uint64 public immutable disputeWindow;
    uint64 public immutable clockSkew;
    uint256 public immutable challengerRewardBps;
    /// @notice Domain separator bound into every proof: keccak("KAKUSHI_V1", chainid, this) >> 8.
    bytes32 public immutable domain;

    mapping(bytes32 disputeKey => Dispute) public disputes;
    mapping(bytes32 disputeKey => bool) public settled;

    event DisputeOpened(
        bytes32 indexed disputeKey, bytes32 indexed srcRef, address indexed maker, address opener, uint64 srcChainId, bytes32 srcTxHash, uint32 logIndex
    );
    event DisputeSlashed(
        bytes32 indexed disputeKey, address indexed maker, address indexed sender, address marginToken, uint256 compensation, uint256 paid, uint256 reward
    );
    event DisputeMakerProven(bytes32 indexed disputeKey, address indexed maker);
    event DisputeExpired(bytes32 indexed disputeKey, address indexed maker);

    struct Config {
        EBC ebc;
        MDC mdc;
        AttestationOracle oracle;
        IVerifier complianceVerifier;
        IVerifier inclusionVerifier;
        uint256 bondAmount;
        uint64 fillWindow;
        uint64 disputeWindow;
        uint64 clockSkew;
        uint256 challengerRewardBps;
    }

    constructor(Config memory cfg) {
        ebc = cfg.ebc;
        mdc = cfg.mdc;
        oracle = cfg.oracle;
        complianceVerifier = cfg.complianceVerifier;
        inclusionVerifier = cfg.inclusionVerifier;
        bondAmount = cfg.bondAmount;
        fillWindow = cfg.fillWindow;
        disputeWindow = cfg.disputeWindow;
        clockSkew = cfg.clockSkew;
        challengerRewardBps = cfg.challengerRewardBps;
        domain = bytes32(uint256(keccak256(abi.encode("KAKUSHI_V1", block.chainid, address(this)))) >> 8);
    }

    function disputeKeyOf(bytes32 srcRef, address maker) public pure returns (bytes32) {
        return keccak256(abi.encode(srcRef, maker));
    }

    // ------------------------------------------------------------------ open

    function openDispute(uint64 srcChainId, bytes32 srcTxHash, uint32 logIndex, address maker)
        external
        payable
        returns (bytes32 key)
    {
        if (msg.value != bondAmount) revert Errors.WrongValue(msg.value, bondAmount);
        if (maker == address(0)) revert Errors.ZeroAddress();
        bytes32 srcRef = SrcRef.compute(srcChainId, srcTxHash, logIndex);
        key = disputeKeyOf(srcRef, maker);
        if (settled[key]) revert Errors.AlreadySettled(key);
        if (disputes[key].status == Status.Open) revert Errors.AlreadyDisputed(key);

        disputes[key] = Dispute(msg.sender, maker, uint64(block.timestamp), Status.Open, uint128(msg.value), srcRef);
        mdc.lockDispute(maker);
        emit DisputeOpened(key, srcRef, maker, msg.sender, srcChainId, srcTxHash, logIndex);
    }

    // ------------------------------------------------------------------ prove (slash)

    function proveDispute(Claim calldata c, uint256[] calldata payoutWindowIds, bytes calldata proof)
        external
        nonReentrant
    {
        (bytes32 key, Dispute storage d) = _openDispute(c);
        if (block.timestamp > d.openedAt + disputeWindow) revert Errors.DisputeWindowClosed(key);

        EBC.Classification memory k = ebc.classify(c.maker, c.srcChainId, c.srcToken, c.gross, c.srcTimestamp);
        if (k.kind == Kinds.NONE) revert Errors.NoObligation();
        uint64 deadline = c.srcTimestamp + fillWindow;
        if (block.timestamp <= deadline) revert Errors.DeadlineNotReached(deadline);

        bytes32[] memory pi = new bytes32[](COMPLIANCE_INPUTS);
        _fillCommon(pi, c, k, d.srcRef, deadline);
        _fillWindows(pi, payoutWindowIds, k.obligationChainId, c.srcTimestamp, deadline);
        if (!complianceVerifier.verify(proof, pi)) revert Errors.InvalidProof();

        // effects
        d.status = Status.Slashed;
        settled[key] = true;
        mdc.unlockDispute(c.maker);

        // interactions
        uint256 comp = mdc.compensation(c.gross, k.marginToken, k.priceFeed, k.srcDecimals);
        uint256 paid = mdc.slash(c.maker, k.marginToken, c.sender, comp, key);
        uint256 reward = mdc.slash(c.maker, k.marginToken, d.opener, (comp * challengerRewardBps) / BPS, key);
        d.opener.sendNative(d.bond);
        emit DisputeSlashed(key, c.maker, c.sender, k.marginToken, comp, paid, reward);
    }

    // ------------------------------------------------------------------ answer (maker)

    function answerDispute(Claim calldata c, uint256 payoutWindowId, bytes calldata proof) external nonReentrant {
        (bytes32 key, Dispute storage d) = _openDispute(c);

        EBC.Classification memory k = ebc.classify(c.maker, c.srcChainId, c.srcToken, c.gross, c.srcTimestamp);
        if (k.kind == Kinds.NONE) revert Errors.NoObligation();
        uint64 deadline = c.srcTimestamp + fillWindow;

        AttestationOracle.Window memory w = oracle.getWindow(payoutWindowId);
        if (w.kind != Kinds.WINDOW_PAYOUT) revert Errors.WrongWindowKind(payoutWindowId);
        if (w.chainId != k.obligationChainId) {
            revert Errors.WrongWindowChain(payoutWindowId, k.obligationChainId, w.chainId);
        }

        bytes32[] memory pi = new bytes32[](INCLUSION_INPUTS);
        _fillCommon(pi, c, k, d.srcRef, deadline);
        pi[18] = bytes32(w.root);
        if (!inclusionVerifier.verify(proof, pi)) revert Errors.InvalidProof();

        d.status = Status.MakerProven;
        settled[key] = true;
        mdc.unlockDispute(c.maker);
        c.maker.sendNative(d.bond);
        emit DisputeMakerProven(key, c.maker);
    }

    // ------------------------------------------------------------------ expire

    function expire(bytes32 key) external nonReentrant {
        Dispute storage d = disputes[key];
        if (d.status != Status.Open) revert Errors.DisputeNotOpen(key);
        if (block.timestamp <= d.openedAt + disputeWindow) revert Errors.DisputeWindowOpen(key);
        d.status = Status.Expired;
        mdc.unlockDispute(d.maker);
        d.maker.sendNative(d.bond);
        emit DisputeExpired(key, d.maker);
    }

    // ------------------------------------------------------------------ internals

    function _openDispute(Claim calldata c) internal view returns (bytes32 key, Dispute storage d) {
        bytes32 srcRef = SrcRef.compute(c.srcChainId, c.srcTxHash, c.logIndex);
        key = disputeKeyOf(srcRef, c.maker);
        d = disputes[key];
        if (d.status != Status.Open) revert Errors.DisputeNotOpen(key);
    }

    /// @dev pi[0..17] shared by both circuits:
    ///      domain, srcChainId, obligationChainId, srcRef, maker, sender, recipient, srcToken,
    ///      payToken, gross, identCode, withholding, bps, expected, mode, srcTimestamp, deadline, srcRoot
    function _fillCommon(
        bytes32[] memory pi,
        Claim calldata c,
        EBC.Classification memory k,
        bytes32 srcRef,
        uint64 deadline
    ) internal view {
        AttestationOracle.Window memory sw = oracle.getWindow(c.srcWindowId);
        if (sw.kind != Kinds.WINDOW_SOURCE) revert Errors.WrongWindowKind(c.srcWindowId);
        if (sw.chainId != c.srcChainId) revert Errors.WrongWindowChain(c.srcWindowId, c.srcChainId, sw.chainId);

        pi[0] = domain;
        pi[1] = bytes32(uint256(c.srcChainId));
        pi[2] = bytes32(uint256(k.obligationChainId));
        pi[3] = srcRef;
        pi[4] = bytes32(uint256(uint160(c.maker)));
        pi[5] = bytes32(uint256(uint160(c.sender)));
        pi[6] = bytes32(uint256(uint160(k.kind == Kinds.FILL ? c.recipient : c.sender)));
        pi[7] = bytes32(uint256(uint160(c.srcToken)));
        pi[8] = bytes32(uint256(uint160(k.payToken)));
        pi[9] = bytes32(c.gross);
        pi[10] = bytes32(uint256(k.code));
        pi[11] = bytes32(k.withholding);
        pi[12] = bytes32(k.bps);
        pi[13] = bytes32(k.expected);
        pi[14] = bytes32(uint256(k.kind));
        pi[15] = bytes32(uint256(c.srcTimestamp));
        pi[16] = bytes32(uint256(deadline));
        pi[17] = bytes32(sw.root);
    }

    /// @dev pi[18] = window count, pi[19..26] = payout roots (zero padded). Windows must be
    ///      PAYOUT windows of the obligation chain, block-contiguous, starting at or before
    ///      srcTime - clockSkew and ending at or after the deadline.
    function _fillWindows(
        bytes32[] memory pi,
        uint256[] calldata ids,
        uint64 chainId,
        uint64 srcTimestamp,
        uint64 deadline
    ) internal view {
        uint256 n = ids.length;
        if (n == 0 || n > MAX_WINDOWS) revert Errors.TooManyWindows();
        AttestationOracle.Window memory prev;
        for (uint256 i; i < n; i++) {
            AttestationOracle.Window memory w = oracle.getWindow(ids[i]);
            if (w.kind != Kinds.WINDOW_PAYOUT) revert Errors.WrongWindowKind(ids[i]);
            if (w.chainId != chainId) revert Errors.WrongWindowChain(ids[i], chainId, w.chainId);
            if (i == 0) {
                uint64 start = srcTimestamp > clockSkew ? srcTimestamp - clockSkew : 0;
                if (w.fromTime > start) revert Errors.WindowsDoNotCover();
            } else if (w.fromBlock != prev.toBlock + 1) {
                revert Errors.WindowsDoNotCover();
            }
            pi[19 + i] = bytes32(w.root);
            prev = w;
        }
        if (prev.toTime < deadline) revert Errors.WindowsDoNotCover();
        pi[18] = bytes32(n);
    }
}
