// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {euint64, externalEuint64} from "../lib/FhishTypes.sol";
import {ConfidentialERC20Wrapper, IERC20Like} from "./ConfidentialERC20Wrapper.sol";

/// ERC-2612 + ERC-3009, as implemented by Agora AUSD and Circle USDC.
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface IERC20Authorizations {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title ConfidentialPayments: private stablecoin payments on top of any ERC-20 (AUSD, USDC).
/// @notice Everything a payments app needs, with every amount encrypted:
///   - pay:        a confidential transfer with a public reference (invoice id, memo hash)
///   - pay links:  send to someone who has no wallet yet. The amount is escrowed encrypted; whoever
///                 holds the link's one-time key claims it to their new account (cross-border
///                 remittance by link). Refundable after expiry.
///   - payroll:    one transaction pays many employees; each salary is a separate ciphertext that
///                 only the employer and that employee can read. A payroll operator (e.g. a server
///                 wallet with a spending policy) can run it on the employer's behalf.
///   - gasless onboarding: wrap with an ERC-2612 permit or an ERC-3009 authorization, so a sponsor
///                 can submit the transaction.
/// What the chain learns: who paid whom and when. Never how much, and never anyone's balance.
abstract contract ConfidentialPayments is ConfidentialERC20Wrapper {
    enum LinkState {
        None,
        Open,
        Claimed,
        Refunded
    }

    struct Link {
        address sender;
        address claimKey;
        uint64 expiry;
        LinkState state;
        euint64 amount;
    }

    uint256 public nextLinkId = 1;
    mapping(uint256 => Link) public links;
    /// a payroll reference can be paid once per employer (replay guard for operators and retries)
    mapping(address employer => mapping(bytes32 ref => bool)) public payrollRefUsed;

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PAYROLL_BATCH_TYPEHASH = keccak256(
        "PayrollBatch(address employer,address operator,address[] to,bytes32[] amounts,bytes32 ref,uint256 deadline)"
    );

    event Paid(address indexed from, address indexed to, euint64 amount, bytes32 indexed ref);
    event LinkCreated(uint256 indexed id, address indexed sender, address claimKey, uint64 expiry, euint64 amount);
    event LinkClaimed(uint256 indexed id, address indexed to);
    event LinkRefunded(uint256 indexed id);
    event PayrollRun(address indexed employer, address indexed operator, uint256 count, bytes32 indexed ref);

    error LengthMismatch();
    error LinkNotOpen(uint256 id);
    error LinkExpired(uint256 id);
    error LinkNotExpired(uint256 id);
    error BadClaimSignature();
    error NotSender();
    error PayrollRefUsed(bytes32 ref);
    error BatchExpired();
    error BadEmployerSignature();

    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialERC20Wrapper(underlying_, name_, symbol_)
    {}

    // ------------------------------------------------------------------ onboarding

    /// Wrap with an ERC-2612 permit (one user signature, no prior approve tx).
    function wrapWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        // ignore a failing permit if the allowance already exists (front-run permits)
        try IERC20Authorizations(address(underlying)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _wrapFrom(msg.sender, msg.sender, amount);
    }

    /// Wrap for `from` with an ERC-3009 receiveWithAuthorization: anyone (a gas sponsor) may submit it;
    /// the authorization binds the exact amount and this contract as the recipient.
    function wrapWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (amount > type(uint64).max) revert AmountTooLarge();
        IERC20Authorizations(address(underlying)).receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, nonce, v, r, s);
        _mint(from, FHE.asEuint64(uint64(amount)));
        emit Wrapped(from, amount);
    }

    function _wrapFrom(address payer, address to, uint256 amount) internal {
        if (amount > type(uint64).max) revert AmountTooLarge();
        if (!underlying.transferFrom(payer, address(this), amount)) revert TransferFailed();
        _mint(to, FHE.asEuint64(uint64(amount)));
        emit Wrapped(to, amount);
    }

    // ------------------------------------------------------------------ payments

    function pay(address to, externalEuint64 encryptedAmount, bytes calldata inputProof, bytes32 ref) external returns (euint64 sent) {
        sent = _transfer(msg.sender, to, FHE.fromExternal(encryptedAmount, inputProof));
        emit Paid(msg.sender, to, sent, ref);
    }

    // ------------------------------------------------------------------ pay links

    /// Escrow an encrypted amount behind a one-time claim key (its private key travels in the link).
    function createLink(externalEuint64 encryptedAmount, bytes calldata inputProof, address claimKey, uint64 expiry)
        external
        returns (uint256 id)
    {
        if (expiry <= block.timestamp) revert LinkExpired(0);
        euint64 escrowed = _transfer(msg.sender, address(this), FHE.fromExternal(encryptedAmount, inputProof));
        id = nextLinkId++;
        links[id] = Link(msg.sender, claimKey, expiry, LinkState.Open, escrowed);
        emit LinkCreated(id, msg.sender, claimKey, expiry, escrowed);
    }

    /// The digest the claim key signs (EIP-191) to release link `id` to `to`.
    function claimDigest(uint256 id, address to) public view returns (bytes32) {
        bytes32 h = keccak256(abi.encode(address(this), block.chainid, id, to));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    /// Claim to `to`. Anyone may submit (e.g. a sponsor), but only the link key's signature over
    /// (this, chainid, id, to) releases it, so a front-runner cannot redirect the funds.
    function claimLink(uint256 id, address to, bytes calldata signature) external {
        Link storage l = links[id];
        if (l.state != LinkState.Open) revert LinkNotOpen(id);
        if (block.timestamp > l.expiry) revert LinkExpired(id);
        if (_recover(claimDigest(id, to), signature) != l.claimKey) revert BadClaimSignature();
        l.state = LinkState.Claimed;
        _transfer(address(this), to, l.amount);
        emit LinkClaimed(id, to);
    }

    function refundLink(uint256 id) external {
        Link storage l = links[id];
        if (l.state != LinkState.Open) revert LinkNotOpen(id);
        if (msg.sender != l.sender) revert NotSender();
        if (block.timestamp <= l.expiry) revert LinkNotExpired(id);
        l.state = LinkState.Refunded;
        _transfer(address(this), l.sender, l.amount);
        emit LinkRefunded(id);
    }

    function linkAmount(uint256 id) external view returns (euint64) {
        return links[id].amount;
    }

    // ------------------------------------------------------------------ payroll

    /// Pay many employees in one transaction from the caller's balance.
    function runPayroll(address[] calldata to, externalEuint64[] calldata amounts, bytes[] calldata proofs, bytes32 ref) external {
        _payroll(msg.sender, to, amounts, proofs, ref);
    }

    /// Payroll relayed by an operator (setOperator), e.g. a policy-limited server wallet running it on
    /// schedule. The operator cannot choose anything: the employer signs the exact batch (EIP-712
    /// PayrollBatch: recipients, encrypted amounts, reference, deadline, this operator), each reference
    /// pays once, and the authorization expires. The salaries are encrypted for the operator's address,
    /// so the inputs are bound to it.
    function runPayrollFrom(
        address employer,
        address[] calldata to,
        externalEuint64[] calldata amounts,
        bytes[] calldata proofs,
        bytes32 ref,
        uint256 deadline,
        bytes calldata employerSignature
    ) external {
        if (!isOperator(employer, msg.sender)) revert UnauthorizedSpender(employer, msg.sender);
        if (block.timestamp > deadline) revert BatchExpired();
        if (!_isValidSigner(employer, payrollBatchDigest(employer, msg.sender, to, amounts, ref, deadline), employerSignature)) {
            revert BadEmployerSignature();
        }
        _payroll(employer, to, amounts, proofs, ref);
    }

    function payrollDomainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, keccak256("Fhish Payroll"), keccak256("1"), block.chainid, address(this)));
    }

    function payrollBatchDigest(
        address employer,
        address operator,
        address[] calldata to,
        externalEuint64[] calldata amounts,
        bytes32 ref,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYROLL_BATCH_TYPEHASH,
                employer,
                operator,
                keccak256(abi.encodePacked(to)),
                keccak256(abi.encodePacked(amounts)),
                ref,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", payrollDomainSeparator(), structHash));
    }

    function _payroll(address employer, address[] calldata to, externalEuint64[] calldata amounts, bytes[] calldata proofs, bytes32 ref)
        internal
    {
        if (to.length != amounts.length || to.length != proofs.length) revert LengthMismatch();
        if (payrollRefUsed[employer][ref]) revert PayrollRefUsed(ref);
        payrollRefUsed[employer][ref] = true;
        for (uint256 i; i < to.length; i++) {
            euint64 paid = _transfer(employer, to[i], FHE.fromExternal(amounts[i], proofs[i]));
            emit Paid(employer, to[i], paid, ref);
        }
        emit PayrollRun(employer, msg.sender, to.length, ref);
    }

    /// EOA (including EIP-7702 delegated accounts) first, then ERC-1271 smart wallets.
    function _isValidSigner(address signer, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        if (_recover(digest, sig) == signer) return true;
        if (signer.code.length == 0) return false;
        try IERC1271(signer).isValidSignature(digest, sig) returns (bytes4 v) {
            return v == IERC1271.isValidSignature.selector;
        } catch {
            return false;
        }
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // reject malleable high-s signatures
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
