// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Min} from "../../src/interfaces/IERC20Min.sol";

/// @notice Test-only stand-in for an existing PUBLIC contract that knows nothing about Kakushi:
///         sells orders for a fixed native or token price, credits the `beneficiary` named in the
///         calldata, refunds native overpayment to msg.sender and pulls exactly `tokenPrice` with
///         transferFrom. Used to show a shielded note can pay it privately (withdrawAndCall).
contract DemoMerchant {
    uint256 public immutable price;
    address public immutable payToken;
    uint256 public immutable tokenPrice;
    bool public closed;
    mapping(bytes32 => address) public orderOwner;

    event Paid(bytes32 indexed orderId, address beneficiary, address payer, uint256 amount);

    constructor(uint256 price_, address payToken_, uint256 tokenPrice_) {
        price = price_;
        payToken = payToken_;
        tokenPrice = tokenPrice_;
    }

    function setClosed(bool c) external {
        closed = c;
    }

    function pay(bytes32 orderId, address beneficiary) external payable {
        _order(orderId, beneficiary);
        require(msg.value >= price, "underpaid");
        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            require(ok, "refund failed");
        }
        emit Paid(orderId, beneficiary, msg.sender, price);
    }

    function payWithToken(bytes32 orderId, address beneficiary) external {
        _order(orderId, beneficiary);
        require(IERC20Min(payToken).transferFrom(msg.sender, address(this), tokenPrice), "pull failed");
        emit Paid(orderId, beneficiary, msg.sender, tokenPrice);
    }

    function _order(bytes32 orderId, address beneficiary) internal {
        require(!closed, "merchant closed");
        require(orderOwner[orderId] == address(0), "order already paid");
        orderOwner[orderId] = beneficiary;
    }
}

/// @notice Test-only target that tries to re-enter the pool and the executor during a private call.
contract ReentrantTarget {
    address public pool;
    address public executor;
    bool public depositBlocked;
    bool public callBlocked;
    bool public executeBlocked;

    constructor(address pool_, address executor_) {
        pool = pool_;
        executor = executor_;
    }

    function hit() external payable {
        (bool ok,) = pool.call{value: msg.value}(abi.encodeWithSignature("deposit(bytes32)", bytes32(uint256(99))));
        depositBlocked = !ok;
        (ok,) = pool.call(
            abi.encodeWithSignature(
                "withdrawAndCall(bytes,bytes32,bytes32,address,uint256,address,bytes,address)",
                "", bytes32(0), bytes32(uint256(1)), address(0), 0, address(this), "", address(this)
            )
        );
        callBlocked = !ok;
        (ok,) = executor.call(
            abi.encodeWithSignature(
                "execute(address,uint256,address,bytes,address)", address(0), 0, address(this), "", address(this)
            )
        );
        executeBlocked = !ok;
    }
}
