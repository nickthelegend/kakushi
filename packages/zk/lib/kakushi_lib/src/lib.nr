// Kakushi shared circuit library.
//
// Normative spec: PLAN.md §7.3 (fee math) and §7.5 (leaves, trees, circuits). The same
// formulas live in packages/contracts/src/lib/FeeMath.sol and packages/attest-core.
//
// DEMO ASSUMPTION (labelled here and in the README):
// - Leaves are NORMALIZED payment records attested by the Chainlink CRE workflow, not raw
//   receipt-trie (MPT/keccak) proofs against a block header. Inclusion is proven against the
//   Poseidon2 roots that CRE posts to AttestationOracle on the Monad hub.
// - "Absence" of a payout is a non-membership proof in a SORTED tree (two adjacent leaves
//   bracket the key). It is sound because the oracle only accepts block-contiguous payout
//   windows, so the attested set is complete for the covered range.

use poseidon::poseidon2::Poseidon2;

pub global DEPTH: u32 = 12;
pub global MAX_WINDOWS: u32 = 8;

pub global LEAF_SOURCE: Field = 1;
pub global LEAF_PAYOUT_FILL: Field = 2;
pub global LEAF_PAYOUT_REFUND: Field = 3;

pub global MODE_FILL: Field = 1;
pub global MODE_REFUND: Field = 2;

pub global CODE_MOD: u128 = 10000;
pub global BPS: u128 = 10000;

/// A normalized, attested payment record (source payment or Maker payout).
pub struct Leaf {
    pub kind: Field,
    pub chain_id: Field,
    pub src_ref: Field,
    pub from: Field,
    pub to: Field,
    pub token: Field,
    pub amount: Field,
    pub recipient: Field,
    pub block_number: Field,
    pub timestamp: Field,
}

impl Leaf {
    pub fn data_hash(self) -> Field {
        Poseidon2::hash(
            [
                self.kind, self.chain_id, self.src_ref, self.from, self.to, self.token, self.amount,
                self.recipient, self.block_number, self.timestamp,
            ],
            10,
        )
    }

    /// Source leaves are keyed by srcRef; payout leaves by H(srcRef, maker).
    pub fn key(self) -> Field {
        if self.kind == LEAF_SOURCE {
            self.src_ref
        } else {
            payout_key(self.src_ref, self.from)
        }
    }

    pub fn node(self) -> Field {
        node_hash(self.key(), self.data_hash())
    }
}

pub fn payout_key(src_ref: Field, maker: Field) -> Field {
    Poseidon2::hash([src_ref, maker], 2)
}

pub fn node_hash(key: Field, data: Field) -> Field {
    Poseidon2::hash([key, data], 2)
}

pub fn hash_pair(left: Field, right: Field) -> Field {
    Poseidon2::hash([left, right], 2)
}

pub fn compute_root(leaf: Field, index: Field, path: [Field; DEPTH]) -> Field {
    let bits: [bool; DEPTH] = index.to_le_bits();
    let mut cur = leaf;
    for i in 0..DEPTH {
        if bits[i] {
            cur = hash_pair(path[i], cur);
        } else {
            cur = hash_pair(cur, path[i]);
        }
    }
    cur
}

/// Field -> u128 with an explicit no-truncation check.
pub fn to_u128(x: Field) -> u128 {
    let v = x as u128;
    assert(v as Field == x, "value exceeds u128");
    v
}

pub fn to_u64(x: Field) -> u64 {
    let v = x as u64;
    assert(v as Field == x, "value exceeds u64");
    v
}

/// code = gross % 10_000 ; principal = gross - code
pub fn split_code(gross: Field) -> (Field, Field) {
    let g = to_u128(gross);
    let code = g % CODE_MOD;
    (code as Field, (g - code) as Field)
}

/// net = (principal - withholding) - floor((principal - withholding) * bps / 10_000); 0 if principal <= withholding
pub fn net(principal: Field, withholding: Field, bps: Field) -> Field {
    let p = to_u128(principal);
    let w = to_u128(withholding);
    let b = to_u128(bps);
    let mut out: u128 = 0;
    if p > w {
        let base = p - w;
        out = base - (base * b) / BPS;
    }
    out as Field
}

/// Facts every circuit checks about the source payment (PLAN.md §7.5 steps 1-3).
pub fn check_source(
    src_leaf: Leaf,
    src_index: Field,
    src_path: [Field; DEPTH],
    src_root: Field,
    src_chain_id: Field,
    src_ref: Field,
    maker: Field,
    sender: Field,
    recipient: Field,
    src_token: Field,
    gross: Field,
    ident_code: Field,
    withholding: Field,
    bps: Field,
    expected: Field,
    mode: Field,
    src_timestamp: Field,
) {
    // 1. the source payment exists in an attested source window
    assert(src_leaf.kind == LEAF_SOURCE, "not a source leaf");
    assert(src_leaf.chain_id == src_chain_id, "source chain mismatch");
    assert(src_leaf.src_ref == src_ref, "srcRef mismatch");
    assert(src_leaf.from == sender, "sender mismatch");
    assert(src_leaf.to == maker, "payment not to maker");
    assert(src_leaf.token == src_token, "token mismatch");
    assert(src_leaf.amount == gross, "gross mismatch");
    assert(src_leaf.timestamp == src_timestamp, "timestamp mismatch");
    assert(compute_root(src_leaf.node(), src_index, src_path) == src_root, "source not in attested root");

    // 2. the recipient: FILL pays the encoded recipient, REFUND pays the sender back
    if mode == MODE_FILL {
        assert(src_leaf.recipient == recipient, "recipient mismatch");
    } else {
        assert(mode == MODE_REFUND, "bad mode");
        assert(recipient == sender, "refund must go to sender");
    }

    // 3. the amount encodes the ident code, and the fee math gives `expected`
    let (code, principal) = split_code(gross);
    assert(code == ident_code, "ident code mismatch");
    assert(net(principal, withholding, bps) == expected, "fee math mismatch");
}

/// Is `leaf` a payout that satisfies the obligation?
pub fn is_compliant(
    leaf: Leaf,
    expected_kind: Field,
    obligation_chain_id: Field,
    recipient: Field,
    pay_token: Field,
    expected: Field,
    deadline: Field,
) -> bool {
    (leaf.kind == expected_kind)
        & (leaf.chain_id == obligation_chain_id)
        & (leaf.to == recipient)
        & (leaf.token == pay_token)
        & (to_u128(leaf.amount) >= to_u128(expected))
        & (to_u64(leaf.timestamp) <= to_u64(deadline))
}

pub fn expected_payout_kind(mode: Field) -> Field {
    if mode == MODE_FILL {
        LEAF_PAYOUT_FILL
    } else {
        LEAF_PAYOUT_REFUND
    }
}

/// Non-membership of `key` in a sorted tree: adjacent leaves (index i, i+1) with
/// low_key < key < high_key, both included in `root`.
pub fn assert_absent(
    root: Field,
    key: Field,
    low_key: Field,
    low_data: Field,
    high_key: Field,
    high_data: Field,
    low_index: Field,
    low_path: [Field; DEPTH],
    high_path: [Field; DEPTH],
) {
    assert(compute_root(node_hash(low_key, low_data), low_index, low_path) == root, "low leaf not in root");
    assert(
        compute_root(node_hash(high_key, high_data), low_index + 1, high_path) == root,
        "high leaf not in root",
    );
    assert(low_key.lt(key), "low key not below key");
    assert(key.lt(high_key), "key not below high key");
}

#[test]
fn test_fee_math_worked_example() {
    // PLAN.md §7.3: gross 100_009_001, withholding 50_000, 10 bps -> net 99_850_050
    let (code, principal) = split_code(100009001);
    assert(code == 9001);
    assert(principal == 100000000);
    assert(net(principal, 50000, 10) == 99850050);
}

#[test]
fn test_net_zero_when_below_withholding() {
    assert(net(10000, 20000, 30) == 0);
}

#[test]
fn test_poseidon2_vector() {
    // matches @zkpassport/poseidon2 poseidon2Hash([1n, 2n]) (docs/spikes/poseidon.md)
    assert(
        hash_pair(1, 2) == 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383,
    );
}
