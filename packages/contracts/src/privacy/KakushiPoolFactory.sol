// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {IRootOracle} from "../interfaces/IRootOracle.sol";
import {Errors} from "../lib/Errors.sol";
import {KakushiPool} from "./KakushiPool.sol";

/// @notice The "any token -> private" converter: anyone can open a fixed-denomination shielded
///         pool for any ERC-20 (or the native coin, token = address(0)). One pool per
///         (token, denomination), deployed with CREATE2 from this factory with
///         salt = keccak256(abi.encode(token, denomination)), so its address is predictable
///         (predictPool) and identical for everyone. Every pool uses the factory's shared
///         ShieldedWithdrawVerifier and no root oracle. No owner, no fees, nothing to configure.
contract KakushiPoolFactory {
    IVerifier public immutable verifier;

    /// token => denomination => pool (address(0) if none)
    mapping(address => mapping(uint256 => address)) public poolOf;
    address[] private _pools;

    event PoolCreated(address indexed token, uint256 indexed denomination, address pool, address indexed creator);

    constructor(IVerifier verifier_) {
        if (address(verifier_) == address(0)) revert Errors.ZeroAddress();
        verifier = verifier_;
    }

    /// @notice Deploy the pool for (token, denomination). Reverts if it exists, if token is
    ///         neither address(0) nor a contract, or if denomination is 0 (or >= 2^128, KakushiPool).
    function createPool(address token, uint256 denomination) external returns (address pool) {
        if (denomination == 0) revert Errors.InvalidParams();
        if (token != address(0) && token.code.length == 0) revert Errors.InvalidParams();
        address existing = poolOf[token][denomination];
        if (existing != address(0)) revert Errors.PoolExists(token, denomination, existing);
        pool = address(
            new KakushiPool{salt: salt(token, denomination)}(verifier, token, denomination, IRootOracle(address(0)))
        );
        poolOf[token][denomination] = pool;
        _pools.push(pool);
        emit PoolCreated(token, denomination, pool, msg.sender);
    }

    function salt(address token, uint256 denomination) public pure returns (bytes32) {
        return keccak256(abi.encode(token, denomination));
    }

    /// @notice Where createPool(token, denomination) deploys (whether or not it exists yet).
    function predictPool(address token, uint256 denomination) external view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(KakushiPool).creationCode, abi.encode(verifier, token, denomination, IRootOracle(address(0)))
            )
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt(token, denomination), initHash))))
        );
    }

    function allPools() external view returns (address[] memory) {
        return _pools;
    }

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }
}
