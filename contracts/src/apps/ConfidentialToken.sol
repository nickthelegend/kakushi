// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {ebool, euint64, externalEuint64} from "../lib/FhishTypes.sol";

/// @title ConfidentialToken: ERC-7984-shaped token with encrypted balances.
/// @notice Balances and transfer amounts are euint64 handles. A transfer of more than the balance
///         silently moves 0 (FHE.select), so the chain never learns whether it "failed".
///         Only the holder (and this contract) may decrypt a balance; the SDK does it with an
///         EIP-712-authorized user decryption.
abstract contract ConfidentialToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => euint64) internal _balances;
    euint64 internal _totalSupply;
    mapping(address holder => mapping(address operator => uint48 until)) public operatorUntil;

    event ConfidentialTransfer(address indexed from, address indexed to, euint64 indexed amount);
    event OperatorSet(address indexed holder, address indexed operator, uint48 until);

    error UnauthorizedSpender(address holder, address spender);
    error UnauthorizedHandle(bytes32 handle);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    function confidentialTotalSupply() external view returns (euint64) {
        return _totalSupply;
    }

    function setOperator(address operator, uint48 until) external {
        operatorUntil[msg.sender][operator] = until;
        emit OperatorSet(msg.sender, operator, until);
    }

    function isOperator(address holder, address spender) public view returns (bool) {
        return holder == spender || operatorUntil[holder][spender] >= block.timestamp;
    }

    /// Transfer a client-encrypted amount.
    function confidentialTransfer(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        return _transfer(msg.sender, to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    /// Transfer an amount handle the caller is allowed to use.
    function confidentialTransfer(address to, euint64 amount) external returns (euint64) {
        if (!FHE.isSenderAllowed(amount)) revert UnauthorizedHandle(FHE.toBytes32(amount));
        return _transfer(msg.sender, to, amount);
    }

    function confidentialTransferFrom(address from, address to, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        returns (euint64)
    {
        if (!isOperator(from, msg.sender)) revert UnauthorizedSpender(from, msg.sender);
        return _transfer(from, to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    function _transfer(address from, address to, euint64 amount) internal returns (euint64 transferred) {
        ebool ok = FHE.ge(_balances[from], amount);
        transferred = FHE.select(ok, amount, FHE.asEuint64(0));
        _balances[from] = FHE.sub(_balances[from], transferred);
        _balances[to] = FHE.add(_balances[to], transferred);
        _persist(from);
        _persist(to);
        FHE.allowThis(transferred);
        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
        emit ConfidentialTransfer(from, to, transferred);
    }

    function _mint(address to, euint64 amount) internal {
        _balances[to] = FHE.add(_balances[to], amount);
        _totalSupply = FHE.add(_totalSupply, amount);
        _persist(to);
        FHE.allowThis(_totalSupply);
        emit ConfidentialTransfer(address(0), to, amount);
    }

    function _burn(address from, euint64 amount) internal returns (euint64 burned) {
        ebool ok = FHE.ge(_balances[from], amount);
        burned = FHE.select(ok, amount, FHE.asEuint64(0));
        _balances[from] = FHE.sub(_balances[from], burned);
        _totalSupply = FHE.sub(_totalSupply, burned);
        _persist(from);
        FHE.allowThis(_totalSupply);
        FHE.allowThis(burned);
        emit ConfidentialTransfer(from, address(0), burned);
    }

    function _persist(address a) internal {
        FHE.allowThis(_balances[a]);
        FHE.allow(_balances[a], a);
    }
}
