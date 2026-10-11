// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {ebool, euint32, euint64, externalEuint64} from "../lib/KakushiTypes.sol";

/// @title SealedBidAuction: bids stay encrypted forever; only the winner and price are revealed.
/// @notice Each bid updates an encrypted running maximum and an encrypted winner index with
///         FHE.gt / FHE.select. After the deadline anyone calls close(); the KMS reveals exactly two
///         numbers (highest bid, winner index) through the decryption oracle. Losing bids are never
///         decrypted by anyone.
abstract contract SealedBidAuction {
    address public immutable seller;
    uint256 public immutable endTime;
    string public item;

    address[] public bidders;
    mapping(address => bool) public hasBid;
    mapping(address => euint64) internal _bids;
    euint64 internal _highest;
    euint32 internal _winnerIdx;

    bool public closing;
    bool public settled;
    address public winner;
    uint256 public price;
    uint256 public closeRequestId;

    event BidPlaced(address indexed bidder, uint256 index);
    event ClosingRequested(uint256 requestId);
    event Settled(address indexed winner, uint256 price);

    error AuctionOver();
    error AuctionNotOver();
    error AlreadyBid();
    error NoBids();
    error OnlyOracle();

    constructor(string memory item_, uint256 duration) {
        seller = msg.sender;
        item = item_;
        endTime = block.timestamp + duration;
    }

    function bidCount() external view returns (uint256) {
        return bidders.length;
    }

    function myBid() external view returns (euint64) {
        return _bids[msg.sender];
    }

    function bid(externalEuint64 encryptedBid, bytes calldata inputProof) external {
        if (block.timestamp >= endTime || closing) revert AuctionOver();
        if (hasBid[msg.sender]) revert AlreadyBid();
        euint64 b = FHE.fromExternal(encryptedBid, inputProof);
        uint32 idx = uint32(bidders.length);
        bidders.push(msg.sender);
        hasBid[msg.sender] = true;
        _bids[msg.sender] = b;
        FHE.allowThis(b);
        FHE.allow(b, msg.sender); // a bidder can always decrypt their own bid
        if (idx == 0) {
            _highest = b;
            _winnerIdx = FHE.asEuint32(0);
        } else {
            ebool higher = FHE.gt(b, _highest);
            _highest = FHE.select(higher, b, _highest);
            _winnerIdx = FHE.select(higher, FHE.asEuint32(idx), _winnerIdx);
        }
        FHE.allowThis(_highest);
        FHE.allowThis(_winnerIdx);
        emit BidPlaced(msg.sender, idx);
    }

    function close() external returns (uint256 requestId) {
        if (block.timestamp < endTime) revert AuctionNotOver();
        if (closing) revert AuctionOver();
        if (bidders.length == 0) revert NoBids();
        closing = true;
        bytes32[] memory hs = new bytes32[](2);
        hs[0] = FHE.toBytes32(_highest);
        hs[1] = FHE.toBytes32(_winnerIdx);
        requestId = FHE.requestDecryption(hs, this.onRevealed.selector);
        closeRequestId = requestId;
        emit ClosingRequested(requestId);
    }

    function onRevealed(uint256 requestId, uint256[] calldata cleartexts) external {
        if (msg.sender != FHE.oracle()) revert OnlyOracle();
        if (requestId != closeRequestId || settled) return;
        settled = true;
        price = cleartexts[0];
        winner = bidders[cleartexts[1]];
        emit Settled(winner, price);
    }
}
