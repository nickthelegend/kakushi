// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Poseidon2} from "../../src/lib/Poseidon2.sol";
import {PoolZeros} from "../../src/privacy/PoolZeros.sol";

/// @notice Poseidon2.sol is bit-compatible with Noir (noir-lang/poseidon v0.4.0) and bb.js.
///         - fixed vectors: the same constants are asserted by the Noir test
///           packages/zk/circuits/shielded_withdraw::test_poseidon2_vectors (Noir == Solidity)
///         - random vectors: computed here and, via FFI, by bb.js (Barretenberg's own poseidon2)
///           and the zkpassport poseidon2 package (the off-chain hasher of attest-core)
contract Poseidon2Test is Test {
    uint256 constant P = Poseidon2.P;

    function test_FixedVectorsMatchNoir() public pure {
        assertEq(Poseidon2.hash1(1), 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373);
        assertEq(Poseidon2.hash2(1, 2), 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
        assertEq(Poseidon2.hash2(0, 0), 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1);
        assertEq(Poseidon2.hash3(1, 2, 3), 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8);
        assertEq(Poseidon2.hash2(P - 1, P - 2), 0x2a3af28ae45056e36af2c3a829f1500c199a3f0aa681c199b7366d00676f0ca9);
        uint256[] memory five = new uint256[](5);
        for (uint256 i; i < 5; i++) five[i] = i + 1;
        assertEq(Poseidon2.hash(five), 0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db);
    }

    function test_RandomVectorsMatchBbJsAndZkpassport() public {
        uint256 n = 24;
        uint256[][] memory vectors = new uint256[][](n);
        string memory json = '{"mode":"hash","vectors":[';
        for (uint256 v; v < n; v++) {
            uint256 len = v % 8; // 0..7: empty, partial and multi-block sponges
            vectors[v] = new uint256[](len);
            json = string.concat(json, v == 0 ? "[" : ",[");
            for (uint256 i; i < len; i++) {
                uint256 x = uint256(keccak256(abi.encode("poseidon2-vector", v, i))) % P;
                if (v % 5 == 4) x = P - 1 - i; // edge of the field
                vectors[v][i] = x;
                json = string.concat(json, i == 0 ? '"' : ',"', vm.toString(x), '"');
            }
            json = string.concat(json, "]");
        }
        json = string.concat(json, "]}");
        (uint256[] memory zk, uint256[] memory bb) = abi.decode(_ffi(json), (uint256[], uint256[]));
        assertEq(zk.length, n);
        for (uint256 v; v < n; v++) {
            uint256 sol = Poseidon2.hash(vectors[v]);
            assertEq(sol, bb[v], "Solidity != bb.js");
            assertEq(sol, zk[v], "Solidity != zkpassport");
            if (vectors[v].length == 1) assertEq(Poseidon2.hash1(vectors[v][0]), sol);
            if (vectors[v].length == 2) assertEq(Poseidon2.hash2(vectors[v][0], vectors[v][1]), sol);
            if (vectors[v].length == 3) assertEq(Poseidon2.hash3(vectors[v][0], vectors[v][1], vectors[v][2]), sol);
        }
    }

    function testFuzz_FixedArityMatchesSponge(uint256 a, uint256 b, uint256 c) public pure {
        a %= P;
        b %= P;
        c %= P;
        uint256[] memory xs = new uint256[](3);
        xs[0] = a;
        xs[1] = b;
        xs[2] = c;
        assertEq(Poseidon2.hash3(a, b, c), Poseidon2.hash(xs));
        assembly {
            mstore(xs, 2)
        }
        assertEq(Poseidon2.hash2(a, b), Poseidon2.hash(xs));
        assembly {
            mstore(xs, 1)
        }
        assertEq(Poseidon2.hash1(a), Poseidon2.hash(xs));
    }

    function testFuzz_InputsAreReducedModP(uint256 a) public pure {
        vm.assume(a >= P);
        assertEq(Poseidon2.hash2(a, 7), Poseidon2.hash2(a % P, 7));
    }

    function test_PoolZerosChain() public pure {
        assertEq(PoolZeros.zeros(0), uint256(keccak256("kakushi.pool.zero")) % P);
        assertEq(PoolZeros.ZERO_VALUE, PoolZeros.zeros(0));
        for (uint256 i; i < PoolZeros.DEPTH; i++) {
            assertEq(PoolZeros.zeros(i + 1), Poseidon2.hash2(PoolZeros.zeros(i), PoolZeros.zeros(i)));
        }
    }

    function test_PoolZerosOutOfRangeReverts() public {
        Wrapper w = new Wrapper();
        vm.expectRevert();
        w.zeros(PoolZeros.DEPTH + 1);
    }

    function test_GasHash2() public view {
        uint256 g = gasleft();
        uint256 h = Poseidon2.hash2(1, 2);
        g -= gasleft();
        assertEq(h, 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
        console2.log("Poseidon2.hash2 gas", g);
    }

    function _ffi(string memory json) internal returns (bytes memory) {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../attest-core/scripts/pool-ffi.ts";
        cmd[2] = json;
        return vm.ffi(cmd);
    }
}

contract Wrapper {
    function zeros(uint256 i) external pure returns (uint256) {
        return PoolZeros.zeros(i);
    }
}
