// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Deployable examples: each one is a plain app + `FhishConfig`. That is the whole integration.
// List FhishConfig FIRST so its constructor (which loads the Fhish addresses) runs before the app's.
import {FhishConfig} from "../FhishConfig.sol";
import {ConfidentialToken} from "../apps/ConfidentialToken.sol";
import {ConfidentialERC20Wrapper, IERC20Like} from "../apps/ConfidentialERC20Wrapper.sol";
import {SealedBidAuction} from "../apps/SealedBidAuction.sol";
import {ConfidentialVoting} from "../apps/ConfidentialVoting.sol";
import {DarkOTC} from "../apps/DarkOTC.sol";
import {ConfidentialPayments} from "../apps/ConfidentialPayments.sol";

/// cUSDC: confidential Monad USDC (wrap any ERC-20).
contract ConfidentialWrappedToken is FhishConfig, ConfidentialERC20Wrapper {
    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialERC20Wrapper(underlying_, name_, symbol_)
    {}
}

contract FhishAuction is FhishConfig, SealedBidAuction {
    constructor(string memory item_, uint256 duration) SealedBidAuction(item_, duration) {}
}

contract FhishVote is FhishConfig, ConfidentialVoting {
    constructor(string memory question_, uint256 duration) ConfidentialVoting(question_, duration) {}
}

contract FhishDarkOTC is FhishConfig, DarkOTC {}

/// Fhish Pay token: confidential AUSD / USDC with private payments, pay links and payroll.
contract FhishPayToken is FhishConfig, ConfidentialPayments {
    constructor(IERC20Like underlying_, string memory name_, string memory symbol_)
        ConfidentialPayments(underlying_, name_, symbol_)
    {}
}
