// KMS: public decryption. For each DecryptionRequested, wait until the handles are materialized,
// confirm the request on-chain (requester was ACL-allowed when it asked), decrypt with the engine,
// sign the EIP-712 DecryptionResult with k-of-n KMS keys, and deliver it. Delivery is automatic
// (`fulfill` from the relayer) and/or exposed for the Chainlink CRE workflow (GET /decryptions/:id).
// DEMO ASSUMPTION: the n KMS keys run in one process here; in production each is an independent
// operator, and the FHE secret key itself is threshold-shared (roadmap).
import { encodeFunctionData, keccak256, encodePacked, type Hex, type PublicClient, type WalletClient, type PrivateKeyAccount } from "viem";
import { sendSync } from "./send.ts";
import { oracleAbi } from "./abi.ts";
import type { Engine } from "./engine.ts";
import type { OpGraph } from "./graph.ts";
import type { Metrics } from "./metrics.ts";

export interface SignedResult {
  requestId: string;
  handles: Hex[];
  cleartexts: string[];
  signatures: Hex[];
  decryptedAt: number;
  fulfilledTx?: Hex;
}

export class Kms {
  results = new Map<string, SignedResult>();
  private inflight = new Set<string>();
  readonly opts: {
    client: PublicClient;
    relayer: WalletClient | null;
    oracle: Hex;
    chainId: number;
    signers: PrivateKeyAccount[];
    threshold: number;
    engine: Engine;
    graph: OpGraph;
    metrics: Metrics;
    deliver: "direct" | "cre" | "both";
    /**
     * Monad commit states: ciphertexts are computed speculatively as soon as ops appear (latest), but
     * the KMS signs a public decryption only once the request's block is `finalized` (~2 blocks on
     * Monad), so a reorged request can never leak a plaintext. "latest" skips the wait (debugging).
     */
    decryptAt: "finalized" | "latest";
    log: (m: string) => void;
  };

  constructor(opts: Kms["opts"]) {
    this.opts = opts;
  }

  /** Resolves once `block` is finalized; returns how long that took. */
  private async finalized(block: bigint): Promise<number> {
    const t = Date.now();
    for (;;) {
      const f = await this.opts.client.getBlock({ blockTag: "finalized" });
      if (f.number !== null && f.number >= block) return Date.now() - t;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** Send `fulfill` from the relayer; retried with backoff, and skipped once anyone (e.g. CRE) fulfilled it. */
  private async deliver(result: SignedResult, seenAt: number): Promise<void> {
    const o = this.opts;
    const requestId = BigInt(result.requestId);
    const data = encodeFunctionData({ abi: oracleAbi, functionName: "fulfill", args: [requestId, result.cleartexts.map(BigInt), result.signatures] });
    for (let attempt = 0; ; attempt++) {
      try {
        const req = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] })) as readonly [Hex, Hex, boolean, Hex];
        if (req[2]) return; // delivered by another path
        const rc = await sendSync(o.client, o.relayer!, { to: o.oracle, data });
        result.fulfilledTx = rc.hash;
        o.metrics.add("request_to_callback", Date.now() - seenAt);
        o.metrics.inc("fulfilled");
        o.log(`request ${result.requestId}: decrypted ${result.handles.length} handle(s), callback ${rc.status} in ${Date.now() - seenAt} ms${rc.sync ? " (eth_sendRawTransactionSync)" : ""}`);
        return;
      } catch (e) {
        if (attempt >= 4) throw e;
        o.metrics.inc("deliver.retries");
        o.log(`request ${result.requestId}: delivery attempt ${attempt + 1} failed (${(e as Error).message.split("\n")[0]}), retrying`);
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }

  async handleRequest(requestId: bigint, handles: Hex[], seenAt: number, block?: bigint): Promise<void> {
    const id = requestId.toString();
    if (this.inflight.has(id) || this.results.has(id)) return;
    this.inflight.add(id);
    const o = this.opts;
    try {
      const req = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] })) as readonly [Hex, Hex, boolean, Hex];
      if (req[2]) return; // already fulfilled
      const onchain = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "handlesOf", args: [requestId] })) as Hex[];
      if (onchain.join() !== handles.join()) throw new Error("request handles mismatch");
      // speculative: materialize while the request block finalizes
      const [, finalityMs] = await Promise.all([
        Promise.all(handles.map((h) => o.graph.waitFor(h))),
        o.decryptAt === "finalized" && block !== undefined ? this.finalized(block) : Promise.resolve(0),
      ]);
      if (o.decryptAt === "finalized") {
        o.metrics.add("kms.finality_wait", finalityMs);
        const final = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "handlesOf", args: [requestId], blockTag: "finalized" })) as Hex[];
        if (final.join() !== handles.join()) throw new Error("request not in the finalized chain");
      }
      const clear = await Promise.all(handles.map((h) => o.engine.decrypt(h)));
      const handlesHash = keccak256(encodePacked(["bytes32[]"], [handles]));
      const cleartextsHash = keccak256(encodePacked(["uint256[]"], [clear]));
      const domain = { name: "KakushiDecryptionOracle", version: "1", chainId: o.chainId, verifyingContract: o.oracle } as const;
      const types = { DecryptionResult: [{ name: "requestId", type: "uint256" }, { name: "handlesHash", type: "bytes32" }, { name: "cleartextsHash", type: "bytes32" }] } as const;
      const signatures = await Promise.all(
        o.signers.slice(0, o.threshold).map((s) => s.signTypedData({ domain, types, primaryType: "DecryptionResult", message: { requestId, handlesHash, cleartextsHash } })),
      );
      const result: SignedResult = { requestId: id, handles, cleartexts: clear.map(String), signatures, decryptedAt: Date.now() };
      this.results.set(id, result);
      o.metrics.add("kms.decrypt", Date.now() - seenAt);
      if ((o.deliver === "direct" || o.deliver === "both") && o.relayer) await this.deliver(result, seenAt);
    } catch (e) {
      o.metrics.inc("kms.errors");
      o.log(`request ${id}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      this.inflight.delete(id);
    }
  }
}
