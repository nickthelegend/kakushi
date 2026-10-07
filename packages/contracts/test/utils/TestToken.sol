// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only ERC-20 (unit tests only; never deployed by scripts).
contract TestToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Test-only token that calls back into a target during transfers (reentrancy tests).
contract ReentrantToken is TestToken {
    address public target;
    bytes public payload;
    bool public reentered;
    bool public reenterSucceeded;

    constructor() TestToken("Evil", "EVIL", 6) {}

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
    }

    function _move(address from, address to, uint256 amount) internal override {
        super._move(from, to, amount);
        if (target != address(0) && !reentered) {
            reentered = true;
            (bool ok,) = target.call(payload);
            reenterSucceeded = ok;
        }
    }
}

/// @notice Test-only Chainlink-style feed.
contract TestFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public decimals = 8;

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Test-only CVI validator.
contract TestValidator {
    mapping(address => bool) public ok;

    function set(address u, bool v) external {
        ok[u] = v;
    }

    function complianceVerify(address, address user) external view returns (bool) {
        return ok[user];
    }
}

/// @notice Test-only verifier double for unit tests of the state machine (dispute tests with
///         real proofs use the generated UltraHonk verifiers).
contract ToggleVerifier {
    bool public result = true;

    function set(bool r) external {
        result = r;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}
