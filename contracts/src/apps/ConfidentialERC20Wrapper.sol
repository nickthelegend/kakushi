// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {euint64, externalEuint64} from "../lib/FhishTypes.sol";
import {ConfidentialToken} from "./ConfidentialToken.sol";

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @title ConfidentialERC20Wrapper: make ANY existing ERC-20 confidential (USDC, AUSD on Monad).
/// @notice wrap: deposit a public amount, receive an encrypted balance. Inside the wrapper every
///         balance and transfer amount is encrypted. unwrap: burn an encrypted amount; the burned
///         value is revealed by the KMS through the decryption oracle, whose callback releases the
///         underlying tokens. Plug-and-play: no change to the underlying token contract.
abstract contract ConfidentialERC20Wrapper is ConfidentialToken {
    IERC20Like public immutable underlying;

    struct Unwrap {
        address to;
        bool done;
    }

    mapping(uint256 => Unwrap) public unwraps;

    event Wrapped(address indexed account, uint256 amount);
    event UnwrapRequested(uint256 indexed requestId, address indexed account);
    event Unwrapped(uint256 indexed requestId, address indexed account, uint256 amount);

    error OnlyOracle();
    error AmountTooLarge();
    error TransferFailed();

    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialToken(name_, symbol_, underlying_.decimals())
    {
        underlying = underlying_;
    }

    function wrap(uint256 amount) external {
        if (amount > type(uint64).max) revert AmountTooLarge();
        if (!underlying.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        _mint(msg.sender, FHE.asEuint64(uint64(amount)));
        emit Wrapped(msg.sender, amount);
    }

    function unwrap(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (uint256 requestId) {
        euint64 burned = _burn(msg.sender, FHE.fromExternal(encryptedAmount, inputProof));
        bytes32[] memory hs = new bytes32[](1);
        hs[0] = FHE.toBytes32(burned);
        requestId = FHE.requestDecryption(hs, this.onUnwrapDecrypted.selector);
        unwraps[requestId] = Unwrap(msg.sender, false);
        emit UnwrapRequested(requestId, msg.sender);
    }

    /// Called by the decryption oracle after k-of-n KMS signatures were verified.
    function onUnwrapDecrypted(uint256 requestId, uint256[] calldata cleartexts) external {
        if (msg.sender != FHE.oracle()) revert OnlyOracle();
        Unwrap storage u = unwraps[requestId];
        if (u.to == address(0) || u.done) return;
        u.done = true;
        if (cleartexts[0] > 0 && !underlying.transfer(u.to, cleartexts[0])) revert TransferFailed();
        emit Unwrapped(requestId, u.to, cleartexts[0]);
    }
}
