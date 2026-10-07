// PaymentCompliance: "the attested source payment exists, and the Maker did NOT pay a
// compliant payout in the attested, contiguous payout windows covering the deadline".
// A valid proof lets DisputeModule.proveDispute slash the Maker's margin to the sender.
//
// Public inputs (order is part of the protocol; DisputeModule builds them on-chain):
//   0 domain  1 src_chain_id  2 obligation_chain_id  3 src_ref  4 maker  5 sender
//   6 recipient  7 src_token  8 pay_token  9 gross  10 ident_code  11 withholding  12 bps
//   13 expected  14 mode  15 src_timestamp  16 deadline  17 src_root  18 window_count
//   19..26 payout_roots[8]
//
// DEMO ASSUMPTION: see packages/zk/lib/kakushi_lib/src/lib.nr (normalized leaves attested by
// Chainlink CRE; absence via sorted-tree non-membership over block-contiguous windows).

use kakushi_lib::{
    assert_absent, check_source, compute_root, DEPTH, expected_payout_kind, is_compliant, Leaf,
    MAX_WINDOWS, payout_key, to_u64,
};

pub struct WindowWitness {
    present: bool,
    // absence witness (present == false)
    low_key: Field,
    low_data: Field,
    high_key: Field,
    high_data: Field,
    low_index: Field,
    low_path: [Field; DEPTH],
    high_path: [Field; DEPTH],
    // presence witness (present == true): the payout exists but is non-compliant
    leaf: Leaf,
    leaf_index: Field,
    leaf_path: [Field; DEPTH],
}

fn main(
    domain: pub Field,
    src_chain_id: pub Field,
    obligation_chain_id: pub Field,
    src_ref: pub Field,
    maker: pub Field,
    sender: pub Field,
    recipient: pub Field,
    src_token: pub Field,
    pay_token: pub Field,
    gross: pub Field,
    ident_code: pub Field,
    withholding: pub Field,
    bps: pub Field,
    expected: pub Field,
    mode: pub Field,
    src_timestamp: pub Field,
    deadline: pub Field,
    src_root: pub Field,
    window_count: pub Field,
    payout_roots: pub [Field; MAX_WINDOWS],
    src_leaf: Leaf,
    src_index: Field,
    src_path: [Field; DEPTH],
    windows: [WindowWitness; MAX_WINDOWS],
) {
    // domain separation: binds the proof to one hub chain + DisputeModule (replay protection)
    assert(domain != 0, "missing domain");

    check_source(
        src_leaf, src_index, src_path, src_root, src_chain_id, src_ref, maker, sender, recipient,
        src_token, gross, ident_code, withholding, bps, expected, mode, src_timestamp,
    );

    let wc = to_u64(window_count);
    assert((wc >= 1) & (wc <= MAX_WINDOWS as u64), "bad window count");
    let key = payout_key(src_ref, maker);
    let expected_kind = expected_payout_kind(mode);

    for i in 0..MAX_WINDOWS {
        if (i as u64) < wc {
            let w = windows[i];
            if w.present {
                // a payout for this (srcRef, maker) exists in window i ...
                assert(w.leaf.kind != 1, "not a payout leaf");
                assert(w.leaf.src_ref == src_ref, "payout srcRef mismatch");
                assert(w.leaf.from == maker, "payout not from maker");
                assert(
                    compute_root(w.leaf.node(), w.leaf_index, w.leaf_path) == payout_roots[i],
                    "payout not in window",
                );
                // ... but it does not satisfy the obligation (amount, recipient, token, kind or late)
                assert(
                    !is_compliant(
                        w.leaf, expected_kind, obligation_chain_id, recipient, pay_token, expected,
                        deadline,
                    ),
                    "payout is compliant",
                );
            } else {
                assert_absent(
                    payout_roots[i], key, w.low_key, w.low_data, w.high_key, w.high_data,
                    w.low_index, w.low_path, w.high_path,
                );
            }
        }
    }
}
