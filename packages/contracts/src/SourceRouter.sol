// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Errors} from "./lib/Errors.sol";
import {FeeMath} from "./lib/FeeMath.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";

/// @title SourceRouter: optional helper for paying a Maker with a custom destination recipient.
/// @notice The default Kakushi payment is a raw transfer straight to the Maker's EOA (the
///         recipient is then the sender's own address on the destination chain). Wallets that
///         want a different recipient call `pay`, which forwards the funds to the Maker in the
///         same tx (nothing is ever held here) and emits `PaymentEncoded`, the log the attester
///         and the circuit read. ERC-20s are pulled into this contract and pushed on, so the
///         Transfer to the Maker has `from == SourceRouter`; the attester ignores those Transfer
///         logs to avoid counting one payment twice.
///
///         The guardian may pause NEW payments. It can never touch funds (there are none).
contract SourceRouter is ReentrancyGuard {
    using SafeTransfer for address;

    address public immutable deployer;
    address public guardian;
    bool public paused;
    mapping(uint16 => bool) public knownCodes;

    event PaymentEncoded(
        address indexed sender, address indexed maker, address token, uint256 gross, uint16 code, address recipient
    );
    event CodeSet(uint16 indexed code, bool known);
    event PausedSet(bool paused);

    constructor(address guardian_) {
        if (guardian_ == address(0)) revert Errors.ZeroAddress();
        deployer = guardian_;
        guardian = guardian_;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert Errors.NotGuardian();
        _;
    }

    function setGuardian(address g) external onlyGuardian {
        guardian = g;
    }

    function setCode(uint16 code, bool known) external onlyGuardian {
        knownCodes[code] = known;
        emit CodeSet(code, known);
    }

    function setPaused(bool p) external onlyGuardian {
        paused = p;
        emit PausedSet(p);
    }

    function pay(address maker, address token, uint256 gross, address recipient) external payable nonReentrant {
        if (paused) revert Errors.Paused();
        if (maker == address(0) || recipient == address(0)) revert Errors.ZeroAddress();
        (uint16 code,) = FeeMath.split(gross);
        if (!knownCodes[code]) revert Errors.InvalidIdentCode(code);
        if (token == address(0)) {
            if (msg.value != gross) revert Errors.WrongValue(msg.value, gross);
            maker.sendNative(gross);
        } else {
            if (msg.value != 0) revert Errors.WrongValue(msg.value, 0);
            token.safeTransferFrom(msg.sender, address(this), gross);
            token.safeTransfer(maker, gross);
        }
        emit PaymentEncoded(msg.sender, maker, token, gross, code, recipient);
    }
}
