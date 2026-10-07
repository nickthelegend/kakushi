import { poseidon2Hash } from "@zkpassport/poseidon2";

/** BN254 scalar field modulus */
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Poseidon2 sponge hash, identical to noir-lang/poseidon v0.4.0 `Poseidon2::hash(input, len)`. */
export function poseidon2(inputs: bigint[]): bigint {
  for (const x of inputs) {
    if (x < 0n || x >= FIELD_MODULUS) throw new Error(`field element out of range: ${x}`);
  }
  return poseidon2Hash(inputs);
}

export function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}
