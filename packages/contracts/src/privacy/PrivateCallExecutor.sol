// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Min} from "../interfaces/IERC20Min.sol";
import {SafeTransfer} from "../lib/SafeTransfer.sol";
import {Errors} from "../lib/Errors.sol";

/// @notice The "any contract call -> private" converter's hands (Railgun relay-adapt style). Each
///         KakushiPool deploys exactly one executor in its constructor (so its address is
///         CREATE(pool, nonce 1)) and binds it as the proof's `recipient` for withdrawAndCall.
///
///         Within one withdrawAndCall the pool sends `amount` (denomination - fee) here and calls
///         execute(), which
///           native pool: target.call{value: amount}(data)
///           ERC-20 pool: approve(target, amount); target.call(data); approve(target, 0)
///         then sweeps EVERYTHING it holds of the pool token and of the native coin to `refundTo`
///         (what the target did not pull, refunds it sent back to msg.sender, stray donations).
///         A failing call reverts with the target's revert data, so the whole withdrawal reverts
///         and the note stays unspent.
///
///         Invariants: only the pool can call execute (and the pool is nonReentrant while it
///         does); native coin is only accepted while a call is executing; nothing is left here
///         at the end of a transaction except assets that are neither the pool token nor the native
///         coin. Targets must therefore credit a beneficiary passed in `data` (e.g. mintTo(user),
///         payFor(orderId)) and never msg.sender: anything else left here can be taken by the next
///         private call.
contract PrivateCallExecutor {
    using SafeTransfer for address;

    address public immutable pool;
    /// 1 = idle, 2 = executing
    uint256 private _state = 1;

    constructor() {
        pool = msg.sender;
    }

    /// refunds from the target during execute() only
    receive() external payable {
        if (_state != 2) revert Errors.NotExecuting();
    }

    /// @param token  the pool token, address(0) = native (then msg.value == amount)
    /// @return refundedToken  pool-token amount swept to refundTo (0 for native pools)
    /// @return refundedNative native amount swept to refundTo
    function execute(address token, uint256 amount, address target, bytes calldata data, address refundTo)
        external
        payable
        returns (uint256 refundedToken, uint256 refundedNative)
    {
        if (msg.sender != pool) revert Errors.NotPool();
        if (_state != 1) revert Errors.NotExecuting();
        _state = 2;

        bool ok;
        bytes memory ret;
        if (token == address(0)) {
            (ok, ret) = target.call{value: amount}(data);
        } else {
            _approve(token, target, amount);
            (ok, ret) = target.call(data);
        }
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        if (token != address(0)) _approve(token, target, 0);
        _state = 1;

        if (token != address(0)) {
            refundedToken = IERC20Min(token).balanceOf(address(this));
            if (refundedToken > 0) token.safeTransfer(refundTo, refundedToken);
        }
        refundedNative = address(this).balance;
        if (refundedNative > 0) refundTo.sendNative(refundedNative);
    }

    /// approve tolerating tokens that return no bool (USDT style); the allowance is always 0 between
    /// calls, so tokens that require resetting to 0 first are fine too
    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(IERC20Min.approve.selector, spender, amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert Errors.TransferFailed();
    }
}
