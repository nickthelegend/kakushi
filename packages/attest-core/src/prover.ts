// Proof generation with noir_js (witness) + bb.js UltraHonk (proof), targeting the EVM
// verifiers (keccak transcript, ZK). Works in Node and in the browser (web worker).
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { InputMap } from "./witness.ts";

export type CircuitName = "payment_compliance" | "payout_inclusion" | "shielded_withdraw";

export interface ProofResult {
  proof: `0x${string}`;
  publicInputs: `0x${string}`[];
  ms: number;
}

const toHex = (b: Uint8Array): `0x${string}` =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

export async function proveWith(
  circuit: CompiledCircuit,
  inputs: InputMap,
  opts: { threads?: number; onStage?: (s: "witness" | "proving" | "done") => void } = {},
): Promise<ProofResult> {
  const t0 = Date.now();
  opts.onStage?.("witness");
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs as never);
  opts.onStage?.("proving");
  const api = await Barretenberg.new({ threads: opts.threads ?? 4 });
  try {
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const pd = await backend.generateProof(witness, { verifierTarget: "evm" });
    opts.onStage?.("done");
    return {
      proof: toHex(pd.proof),
      publicInputs: pd.publicInputs.map((p) => `0x${BigInt(p).toString(16).padStart(64, "0")}` as `0x${string}`),
      ms: Date.now() - t0,
    };
  } finally {
    await api.destroy();
  }
}

/** Node-only convenience: load the checked-in circuit artifact by name. */
export async function loadCircuit(name: CircuitName): Promise<CompiledCircuit> {
  const { readFile } = await import("node:fs/promises");
  const url = new URL(`../circuits/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as CompiledCircuit;
}

export async function prove(name: CircuitName, inputs: InputMap, threads?: number): Promise<ProofResult> {
  return proveWith(await loadCircuit(name), inputs, { threads });
}
