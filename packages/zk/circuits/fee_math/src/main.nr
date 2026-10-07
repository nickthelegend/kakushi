// Exposes the circuit fee math so scripts/fee-vectors.ts can execute it for the
// Solidity == Noir == TypeScript parity check (1000 vectors). Not deployed.
use kakushi_lib::{net, split_code};

fn main(gross: Field, withholding: Field, bps: Field) -> pub (Field, Field, Field) {
    let (code, principal) = split_code(gross);
    (code, principal, net(principal, withholding, bps))
}
