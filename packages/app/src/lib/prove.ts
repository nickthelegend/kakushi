"use client";

export interface BrowserProof {
  proof: `0x${string}`;
  publicInputs: `0x${string}`[];
  ms: number;
}

export function proveInBrowser(circuit: "payment_compliance" | "payout_inclusion", inputs: unknown, onStage?: (s: string) => void): Promise<BrowserProof> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prove.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      if (e.data.stage) return onStage?.(e.data.stage);
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result as BrowserProof);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "prover worker failed"));
    };
    worker.postMessage({ circuit, inputs });
  });
}
