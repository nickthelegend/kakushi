// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FHE} from "../lib/FHE.sol";
import {ebool, euint32, externalEbool} from "../lib/KakushiTypes.sol";

/// @title ConfidentialVoting: ballots are encrypted booleans; only the final tally is revealed.
abstract contract ConfidentialVoting {
    string public question;
    uint256 public immutable endTime;
    euint32 internal _yes;
    euint32 internal _no;
    mapping(address => bool) public voted;
    uint256 public voters;
    bool public tallied;
    uint256 public yes;
    uint256 public no;
    uint256 public tallyRequestId;

    event Voted(address indexed voter);
    event Tallied(uint256 yes, uint256 no);

    error VotingClosed();
    error VotingOpen();
    error AlreadyVoted();
    error OnlyOracle();

    constructor(string memory question_, uint256 duration) {
        question = question_;
        endTime = block.timestamp + duration;
        // start from encrypted zeros so a vote with no ballots can still be tallied
        _yes = FHE.allowThis(FHE.asEuint32(0));
        _no = FHE.allowThis(FHE.asEuint32(0));
    }

    function vote(externalEbool encryptedChoice, bytes calldata inputProof) external {
        if (block.timestamp >= endTime) revert VotingClosed();
        if (voted[msg.sender]) revert AlreadyVoted();
        voted[msg.sender] = true;
        voters++;
        ebool choice = FHE.fromExternal(encryptedChoice, inputProof);
        _yes = FHE.add(_yes, FHE.select(choice, FHE.asEuint32(1), FHE.asEuint32(0)));
        _no = FHE.add(_no, FHE.select(choice, FHE.asEuint32(0), FHE.asEuint32(1)));
        FHE.allowThis(_yes);
        FHE.allowThis(_no);
        emit Voted(msg.sender);
    }

    function tally() external returns (uint256 requestId) {
        if (block.timestamp < endTime) revert VotingOpen();
        if (tallyRequestId != 0) revert VotingClosed();
        bytes32[] memory hs = new bytes32[](2);
        hs[0] = FHE.toBytes32(_yes);
        hs[1] = FHE.toBytes32(_no);
        requestId = FHE.requestDecryption(hs, this.onTallied.selector);
        tallyRequestId = requestId;
    }

    function onTallied(uint256 requestId, uint256[] calldata cleartexts) external {
        if (msg.sender != FHE.oracle()) revert OnlyOracle();
        if (requestId != tallyRequestId || tallied) return;
        tallied = true;
        yes = cleartexts[0];
        no = cleartexts[1];
        emit Tallied(yes, no);
    }
}
