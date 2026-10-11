// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {ebool, euint64, externalEuint64} from "../lib/FhishTypes.sol";

/// @title DarkOTC: a dark order desk. Limit prices are encrypted; nothing leaks unless orders cross.
/// @notice A maker posts an encrypted minimum price (ask) for a size; a taker answers with an
///         encrypted maximum price (bid). The contract computes, homomorphically, whether they cross
///         and the execution price (the maker's ask). Only `crossed` and, if crossed, the price are
///         revealed; a failed match reveals nothing but "no". Front-running a limit you cannot see is
///         impossible. Settlement of the assets is left to the integrating venue (event-driven).
abstract contract DarkOTC {
    struct Order {
        address maker;
        string pair;
        uint256 size;
        euint64 ask;
        bool open;
    }

    struct Take {
        uint256 orderId;
        address taker;
        bool resolved;
        bool crossed;
        uint256 price;
    }

    Order[] internal _orders;
    mapping(uint256 => Take) public takes; // by decryption request id

    event OrderPosted(uint256 indexed orderId, address indexed maker, string pair, uint256 size);
    event TakeRequested(uint256 indexed orderId, uint256 indexed requestId, address indexed taker);
    event Matched(uint256 indexed orderId, address indexed maker, address indexed taker, uint256 size, uint256 price);
    event NoMatch(uint256 indexed orderId, address indexed taker);

    error OrderClosed();
    error OnlyOracle();

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    function orderInfo(uint256 id) external view returns (address maker, string memory pair, uint256 size, bool open) {
        Order storage o = _orders[id];
        return (o.maker, o.pair, o.size, o.open);
    }

    function post(string calldata pair, uint256 size, externalEuint64 encryptedAsk, bytes calldata inputProof)
        external
        returns (uint256 id)
    {
        euint64 ask = FHE.fromExternal(encryptedAsk, inputProof);
        FHE.allowThis(ask);
        FHE.allow(ask, msg.sender);
        id = _orders.length;
        _orders.push(Order(msg.sender, pair, size, ask, true));
        emit OrderPosted(id, msg.sender, pair, size);
    }

    function take(uint256 orderId, externalEuint64 encryptedBid, bytes calldata inputProof) external returns (uint256 requestId) {
        Order storage o = _orders[orderId];
        if (!o.open) revert OrderClosed();
        euint64 bid = FHE.fromExternal(encryptedBid, inputProof);
        ebool crossed = FHE.ge(bid, o.ask);
        euint64 px = FHE.select(crossed, o.ask, FHE.asEuint64(0));
        bytes32[] memory hs = new bytes32[](2);
        hs[0] = FHE.toBytes32(crossed);
        hs[1] = FHE.toBytes32(px);
        FHE.allowThis(crossed);
        FHE.allowThis(px);
        requestId = FHE.requestDecryption(hs, this.onResolved.selector);
        takes[requestId] = Take(orderId, msg.sender, false, false, 0);
        emit TakeRequested(orderId, requestId, msg.sender);
    }

    function onResolved(uint256 requestId, uint256[] calldata cleartexts) external {
        if (msg.sender != FHE.oracle()) revert OnlyOracle();
        Take storage t = takes[requestId];
        if (t.taker == address(0) || t.resolved) return;
        t.resolved = true;
        Order storage o = _orders[t.orderId];
        if (cleartexts[0] == 1 && o.open) {
            o.open = false;
            t.crossed = true;
            t.price = cleartexts[1];
            emit Matched(t.orderId, o.maker, t.taker, o.size, t.price);
        } else {
            emit NoMatch(t.orderId, t.taker);
        }
    }
}
