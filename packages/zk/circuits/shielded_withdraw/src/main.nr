// ShieldedWithdraw: "I know (nullifier, secret) whose commitment is a leaf of the pool tree with
// this root, and this is its nullifier hash." Verified by KakushiPool.withdraw through
// packages/contracts/src/verifiers/ShieldedWithdrawVerifier.sol.
//
// Encodings (mirrored by packages/attest-core/src/pool.ts and KakushiPool.sol):
//   commitment     = Poseidon2::hash([nullifier, secret], 2)      (the leaf)
//   nullifier_hash = Poseidon2::hash([nullifier], 1)
//   node           = Poseidon2::hash([left, right], 2), depth 20
//   path_bits[i]   = bit i (LSB first) of the leaf index: true = running node is the RIGHT child
//
// Public inputs, in verifier order:
//   0 root, 1 nullifier_hash, 2 recipient, 3 relayer, 4 fee, 5 refund, 6 chain_id, 7 pool,
//   8 ext_data_hash
// recipient/relayer/pool are uint160 addresses, chain_id is block.chainid. They are not used by
// the membership statement itself; they are range-constrained below so they are real circuit
// inputs that the proof commits to (a proof for one recipient/relayer/fee/chain/pool cannot be
// replayed with another, front-run, or replayed across chains or pools).
//
// ext_data_hash binds a private call (KakushiPool.withdrawAndCall): 0 for a plain withdrawal,
// otherwise
//   uint256(keccak256(abi.encode(address target, bytes data, address refundTo,
//                                uint256 chainId, address pool))) mod p
// computed by the pool (KakushiPool.extDataHash), so a relayer cannot change the call target,
// the calldata or where leftovers are refunded. A full field element has no range to check, so it
// is bound by a real gate instead: a private call carries no native refund (the pool always
// passes refund = 0 for withdrawAndCall), enforced through ext_data_hash's is-zero gadget.

use poseidon::poseidon2::Poseidon2;

pub global DEPTH: u32 = 20;

pub fn commitment_of(nullifier: Field, secret: Field) -> Field {
    Poseidon2::hash([nullifier, secret], 2)
}

pub fn nullifier_hash_of(nullifier: Field) -> Field {
    Poseidon2::hash([nullifier], 1)
}

pub fn compute_root(leaf: Field, path: [Field; DEPTH], path_bits: [bool; DEPTH]) -> Field {
    let mut cur = leaf;
    for i in 0..DEPTH {
        if path_bits[i] {
            cur = Poseidon2::hash([path[i], cur], 2);
        } else {
            cur = Poseidon2::hash([cur, path[i]], 2);
        }
    }
    cur
}

fn main(
    root: pub Field,
    nullifier_hash: pub Field,
    recipient: pub Field,
    relayer: pub Field,
    fee: pub Field,
    refund: pub Field,
    chain_id: pub Field,
    pool: pub Field,
    ext_data_hash: pub Field,
    nullifier: Field,
    secret: Field,
    path: [Field; DEPTH],
    path_bits: [bool; DEPTH],
) {
    assert(nullifier_hash_of(nullifier) == nullifier_hash, "nullifier hash mismatch");
    let commitment = commitment_of(nullifier, secret);
    assert(compute_root(commitment, path, path_bits) == root, "commitment not in tree");

    // binding inputs: constrained, so they cannot be optimized away
    recipient.assert_max_bit_size::<160>();
    relayer.assert_max_bit_size::<160>();
    pool.assert_max_bit_size::<160>();
    fee.assert_max_bit_size::<128>();
    refund.assert_max_bit_size::<128>();
    chain_id.assert_max_bit_size::<64>();
    assert(pool != 0, "missing pool");
    assert(chain_id != 0, "missing chain id");
    assert((ext_data_hash == 0) | (refund == 0), "private call with refund");
}

// ------------------------------------------------------------------------------------- tests

global NULLIFIER: Field = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd;
global SECRET: Field = 0x0fedcba9876543210fedcba9876543210fedcba9876543210fedcba98765432;
global RECIPIENT: Field = 0x00000000000000000000000000000000000000000000000000000000000000bb;
global RELAYER: Field = 0x00000000000000000000000000000000000000000000000000000000000000cc;
global POOL: Field = 0x000000000000000000000000c0ffee254729296a45a3885639ac7e10f9d54979;
global CHAIN: Field = 10143;

fn test_path() -> ([Field; DEPTH], [bool; DEPTH]) {
    let mut path = [0; DEPTH];
    let mut bits = [false; DEPTH];
    for i in 0..DEPTH {
        path[i] = Poseidon2::hash([i as Field], 1);
        bits[i] = (i % 3) == 1;
    }
    (path, bits)
}

fn valid() -> (Field, Field, [Field; DEPTH], [bool; DEPTH]) {
    let (path, bits) = test_path();
    let root = compute_root(commitment_of(NULLIFIER, SECRET), path, bits);
    (root, nullifier_hash_of(NULLIFIER), path, bits)
}

#[test]
fn test_valid_withdraw() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        5,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

// a private call: ext_data_hash = keccak256(abi.encode(target, data, refundTo, chainId, pool)) mod p
global EXT: Field = 0x1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988;

#[test]
fn test_valid_private_call() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        5,
        0,
        CHAIN,
        POOL,
        EXT,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
    // any field element is a valid ext_data_hash, including p - 1
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        5,
        0,
        CHAIN,
        POOL,
        -1,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "private call with refund")]
fn test_private_call_with_refund() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        5,
        1,
        CHAIN,
        POOL,
        EXT,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test]
fn test_plain_withdraw_with_refund() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        5,
        7,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "nullifier hash mismatch")]
fn test_wrong_nullifier_hash() {
    let (root, _, path, bits) = valid();
    main(
        root,
        nullifier_hash_of(NULLIFIER + 1),
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "commitment not in tree")]
fn test_wrong_secret() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET + 1,
        path,
        bits,
    );
}

#[test(should_fail_with = "commitment not in tree")]
fn test_wrong_root() {
    let (root, nh, path, bits) = valid();
    main(
        root + 1,
        nh,
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "commitment not in tree")]
fn test_wrong_path_bit() {
    let (root, nh, path, mut bits) = valid();
    bits[0] = !bits[0];
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "commitment not in tree")]
fn test_wrong_sibling() {
    let (root, nh, mut path, bits) = valid();
    path[DEPTH - 1] += 1;
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail)]
fn test_recipient_not_an_address() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        1 + 0x10000000000000000000000000000000000000000 * 2,
        RELAYER,
        0,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail)]
fn test_fee_out_of_range() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        -1,
        0,
        CHAIN,
        POOL,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

#[test(should_fail_with = "missing pool")]
fn test_missing_pool() {
    let (root, nh, path, bits) = valid();
    main(
        root,
        nh,
        RECIPIENT,
        RELAYER,
        0,
        0,
        CHAIN,
        0,
        0,
        NULLIFIER,
        SECRET,
        path,
        bits,
    );
}

/// Poseidon2 vectors shared with packages/contracts/test/privacy/Poseidon2.t.sol and
/// packages/attest-core/scripts/gen-poseidon2-sol.ts (Noir == Solidity == bb.js/zkpassport).
#[test]
fn test_poseidon2_vectors() {
    assert(
        Poseidon2::hash([1], 1)
            == 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373,
    );
    assert(
        Poseidon2::hash([1, 2], 2)
            == 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383,
    );
    assert(
        Poseidon2::hash([0, 0], 2)
            == 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1,
    );
    assert(
        Poseidon2::hash([1, 2, 3], 3)
            == 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8,
    );
    assert(
        Poseidon2::hash([-1, -2], 2)
            == 0x2a3af28ae45056e36af2c3a829f1500c199a3f0aa681c199b7366d00676f0ca9,
    );
    assert(
        Poseidon2::hash([1, 2, 3, 4, 5], 5)
            == 0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db,
    );
}

/// Empty-tree root == PoolZeros.zeros(20) in Solidity (zero leaf = keccak256("kakushi.pool.zero") mod p).
#[test]
fn test_empty_tree_root() {
    let mut z: Field = 0x25b050981509767925e5c4a83dbd420549c32b744ac3ee76ed7e9d6fd2c0d8d4;
    for _ in 0..DEPTH {
        z = Poseidon2::hash([z, z], 2);
    }
    assert(z == 0x286a0baf08ac2d1d9f56281cafab9d2a32be3b0ba413f3b4902aacb0819e3757);
}
