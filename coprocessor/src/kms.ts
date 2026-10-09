// KMS: public decryption. For each DecryptionRequested, wait until the handles are materialized,
// confirm the request on-chain (requester was ACL-allowed when it asked), decrypt with the engine,
// sign the EIP-712 DecryptionResult with k-of-n KMS keys, and deliver it. Delivery is automatic
// (`fulfill` from the relayer) and/or exposed for the Chainlink CRE workflow (GET /decryptions/:id).
// DEMO ASSUMPTION: the n KMS keys run in one process here; in production each is an independent
// operator, and the FHE secret key itself is threshold-shared (roadmap).
import { encodeFunctionData, keccak256, encodePacked, type Hex, type PublicClient, type WalletClient, type PrivateKeyAccount } from "viem";
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
    log: (m: string) => void;
  };

  constructor(opts: Kms["opts"]) {
    this.opts = opts;
  }

  async handleRequest(requestId: bigint, handles: Hex[], seenAt: number): Promise<void> {
    const id = requestId.toString();
    if (this.inflight.has(id) || this.results.has(id)) return;
    this.inflight.add(id);
    const o = this.opts;
    try {
      const req = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "requests", args: [requestId] })) as readonly [Hex, Hex, boolean, Hex];
      if (req[2]) return; // already fulfilled
      const onchain = (await o.client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "handlesOf", args: [requestId] })) as Hex[];
      if (onchain.join() !== handles.join()) throw new Error("request handles mismatch");
      await Promise.all(handles.map((h) => o.graph.waitFor(h)));
      const clear = await Promise.all(handles.map((h) => o.engine.decrypt(h)));
      const handlesHash = keccak256(encodePacked(["bytes32[]"], [handles]));
      const cleartextsHash = keccak256(encodePacked(["uint256[]"], [clear]));
      const domain = { name: "FhishDecryptionOracle", version: "1", chainId: o.chainId, verifyingContract: o.oracle } as const;
      const types = { DecryptionResult: [{ name: "requestId", type: "uint256" }, { name: "handlesHash", type: "bytes32" }, { name: "cleartextsHash", type: "bytes32" }] } as const;
      const signatures = await Promise.all(
        o.signers.slice(0, o.threshold).map((s) => s.signTypedData({ domain, types, primaryType: "DecryptionResult", message: { requestId, handlesHash, cleartextsHash } })),
      );
      const result: SignedResult = { requestId: id, handles, cleartexts: clear.map(String), signatures, decryptedAt: Date.now() };
      this.results.set(id, result);
      o.metrics.add("kms.decrypt", Date.now() - seenAt);
      if ((o.deliver === "direct" || o.deliver === "both") && o.relayer) {
        const data = encodeFunctionData({ abi: oracleAbi, functionName: "fulfill", args: [requestId, clear, signatures] });
        const gas = ((await o.client.estimateGas({ account: o.relayer.account!, to: o.oracle, data })) * 13n) / 10n; // Monad bills the gas LIMIT: keep it tight
        const hash = await o.relayer.sendTransaction({ chain: o.relayer.chain, account: o.relayer.account!, to: o.oracle, data, gas });
        const rc = await o.client.waitForTransactionReceipt({ hash });
        result.fulfilledTx = hash;
        o.metrics.add("request_to_callback", Date.now() - seenAt);
        o.metrics.inc("fulfilled");
        o.log(`request ${id}: decrypted ${handles.length} handle(s), callback ${rc.status} in ${Date.now() - seenAt} ms`);
      }
    } catch (e) {
      o.metrics.inc("kms.errors");
      o.log(`request ${id}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      this.inflight.delete(id);
    }
  }
}
