// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Deployable examples: each one is a plain app + `KakushiConfig`. That is the whole integration.
// List KakushiConfig FIRST so its constructor (which loads the Kakushi addresses) runs before the app's.
import {KakushiConfig} from "../KakushiConfig.sol";
import {ConfidentialToken} from "../apps/ConfidentialToken.sol";
import {ConfidentialERC20Wrapper, IERC20Like} from "../apps/ConfidentialERC20Wrapper.sol";
import {SealedBidAuction} from "../apps/SealedBidAuction.sol";
import {ConfidentialVoting} from "../apps/ConfidentialVoting.sol";
import {DarkOTC} from "../apps/DarkOTC.sol";
import {ConfidentialPayments} from "../apps/ConfidentialPayments.sol";

/// cUSDC: confidential Monad USDC (wrap any ERC-20).
contract ConfidentialWrappedToken is KakushiConfig, ConfidentialERC20Wrapper {
    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialERC20Wrapper(underlying_, name_, symbol_)
    {}
}

contract KakushiAuction is KakushiConfig, SealedBidAuction {
    constructor(string memory item_, uint256 duration) SealedBidAuction(item_, duration) {}
}

contract KakushiVote is KakushiConfig, ConfidentialVoting {
    constructor(string memory question_, uint256 duration) ConfidentialVoting(question_, duration) {}
}

contract KakushiDarkOTC is KakushiConfig, DarkOTC {}

/// Kakushi Confidential token: confidential AUSD / USDC with private payments, pay links and payroll.
contract KakushiPayToken is KakushiConfig, ConfidentialPayments {
    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialPayments(underlying_, name_, symbol_)
    {}
}
