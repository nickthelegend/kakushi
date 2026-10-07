// PayoutInclusion: the Maker's defence. "The attested source payment exists, and a compliant
// payout for it (right kind, chain, recipient, token, amount >= expected, on time) is in an
// attested payout window." A valid proof lets DisputeModule.answerDispute close the dispute
// and award the challenger's bond to the Maker.
//
// Public inputs: 0..17 identical to PaymentCompliance, then 18 payout_root.
//
// DEMO ASSUMPTION: see packages/zk/lib/kakushi_lib/src/lib.nr.

use kakushi_lib::{check_source, compute_root, DEPTH, expected_payout_kind, is_compliant, Leaf};

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
    payout_root: pub Field,
    src_leaf: Leaf,
    src_index: Field,
    src_path: [Field; DEPTH],
    payout_leaf: Leaf,
    payout_index: Field,
    payout_path: [Field; DEPTH],
) {
    assert(domain != 0, "missing domain");

    check_source(
        src_leaf, src_index, src_path, src_root, src_chain_id, src_ref, maker, sender, recipient,
        src_token, gross, ident_code, withholding, bps, expected, mode, src_timestamp,
    );

    assert(payout_leaf.kind != 1, "not a payout leaf");
    assert(payout_leaf.src_ref == src_ref, "payout srcRef mismatch");
    assert(payout_leaf.from == maker, "payout not from maker");
    assert(
        compute_root(payout_leaf.node(), payout_index, payout_path) == payout_root,
        "payout not in window",
    );
    assert(
        is_compliant(
            payout_leaf, expected_payout_kind(mode), obligation_chain_id, recipient, pay_token,
            expected, deadline,
        ),
        "payout not compliant",
    );
}
