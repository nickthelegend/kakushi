/// <reference lib="webworker" />
// Proves PaymentCompliance / PayoutInclusion in the browser (noir_js witness + bb.js UltraHonk),
// off the main thread. The circuit artifacts are the same checked-in files the Watchtower uses.
import { proveWith } from "@kakushi/attest-core/prover";
import paymentCompliance from "../../../attest-core/circuits/payment_compliance.json";
import payoutInclusion from "../../../attest-core/circuits/payout_inclusion.json";

self.onmessage = async (e: MessageEvent<{ circuit: "payment_compliance" | "payout_inclusion"; inputs: Record<string, unknown> }>) => {
  try {
    const circuit = (e.data.circuit === "payment_compliance" ? paymentCompliance : payoutInclusion) as never;
    const threads = Math.min(4, (self.navigator?.hardwareConcurrency ?? 2) - 1 || 1);
    const r = await proveWith(circuit, e.data.inputs as never, { threads, onStage: (stage) => self.postMessage({ stage }) });
    self.postMessage({ result: r });
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
