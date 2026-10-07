// Turning a source payment into a dispute: classify it with the hub's rules, find the CRE
// windows that cover it, rebuild their trees from chain data, and produce the circuit witness.
import { type Hex, zeroAddress } from "viem";
import {
  addr,
  complianceInputs,
  type DisputeContext,
  inclusionInputs,
  type InputMap,
  payoutKey,
  SortedTree,
  WINDOW_SOURCE,
} from "@kakushi/attest-core";
import { coveringPayoutWindows, type IndexedWindow, rebuildWindow, recentWindows } from "./attestations.ts";
import type { Kakushi } from "./kakushi.ts";
import { srcRefOf } from "./transfer.ts";
import type { SourcePayment } from "./types.ts";

export interface DisputeClaim {
  srcChainId: bigint;
  srcTxHash: Hex;
  logIndex: number;
  maker: Hex;
  sender: Hex;
  recipient: Hex;
  srcToken: Hex;
  gross: bigint;
  srcTimestamp: bigint;
  srcWindowId: bigint;
}

export type DisputeReadiness =
  | { ready: false; reason: string; retryAfterSec?: number }
  | {
      ready: true;
      mode: "compliance" | "inclusion";
      claim: DisputeClaim;
      payoutWindowIds: bigint[];
      inputs: InputMap;
      publicInputs: bigint[];
      deadline: bigint;
      kind: number;
      expected: bigint;
    };

/**
 * Prepare the PaymentCompliance witness (Sender/Watchtower) or, if the Maker did pay,
 * the PayoutInclusion witness (Maker's answer). `want` forces one mode.
 */
export async function prepareDispute(k: Kakushi, p: SourcePayment, want?: "compliance" | "inclusion"): Promise<DisputeReadiness> {
  const c = await k.classify(p.maker, p.srcChainId, p.token, p.gross, p.timestamp);
  if (c.kind === 0) return { ready: false, reason: "no obligation (top-up code, dust, or not a Maker of this token)" };
  const deadline = p.timestamp + k.fillWindow;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (want !== "inclusion" && now <= deadline) return { ready: false, reason: "fill window still open", retryAfterSec: Number(deadline - now) + 1 };

  const srcRef = srcRefOf(p);
  const makers = await k.makers();
  // SOURCE window holding the payment
  const srcWindows = (await recentWindows(k.hub, k.d.hub.attestationOracle, p.srcChainId, p.timestamp - 600n)).filter(
    (w) => w.kind === WINDOW_SOURCE && w.fromBlock <= p.blockNumber && p.blockNumber <= w.toBlock,
  );
  const srcCtx = await k.chainCtx(p.srcChainId, makers);
  let srcTree: SortedTree | undefined;
  let srcWindow: IndexedWindow | undefined;
  for (const w of srcWindows) {
    try {
      const t = await rebuildWindow(srcCtx, w);
      if (t.indexOf(srcRef) >= 0) {
        srcTree = t;
        srcWindow = w;
        break;
      }
    } catch {
      // a different window over the same block (e.g. a native single-tx attestation)
    }
  }
  if (!srcTree || !srcWindow) {
    return { ready: false, reason: p.token === zeroAddress ? "native source payment not attested yet (ask kakushi-source-native)" : "source payment not attested yet", retryAfterSec: 10 };
  }
  const srcLeaf = srcTree.entries[srcTree.indexOf(srcRef)]!.leaf!;

  // PAYOUT windows on the obligation chain covering [srcTime - skew, deadline]
  const payWindows = await recentWindows(k.hub, k.d.hub.attestationOracle, c.obligationChainId, p.timestamp - k.clockSkew - 600n);
  const payCtx = await k.chainCtx(c.obligationChainId, makers);
  const ctx: DisputeContext = {
    domain: BigInt(k.d.hub.domain),
    srcChainId: BigInt(p.srcChainId),
    obligationChainId: BigInt(c.obligationChainId),
    srcRef,
    maker: addr(p.maker),
    sender: addr(p.sender),
    recipient: addr(c.kind === 1 ? p.recipient : p.sender),
    srcToken: addr(p.token),
    payToken: addr(c.payToken),
    gross: p.gross,
    identCode: BigInt(c.code),
    withholding: c.withholding,
    bps: c.bps,
    expected: c.expected,
    mode: BigInt(c.kind),
    srcTimestamp: p.timestamp,
    deadline,
  };
  const claim: DisputeClaim = {
    srcChainId: BigInt(p.srcChainId),
    srcTxHash: p.txHash,
    logIndex: p.logIndex,
    maker: p.maker,
    sender: p.sender,
    recipient: p.recipient,
    srcToken: p.token,
    gross: p.gross,
    srcTimestamp: p.timestamp,
    srcWindowId: BigInt(srcWindow.id),
  };
  const key = payoutKey(srcRef, addr(p.maker));

  if (want === "inclusion") {
    for (const w of payWindows.filter((x) => x.kind === 2)) {
      if (w.toBlock < p.blockNumber && Number(w.chainId) === p.srcChainId) continue;
      let t: SortedTree;
      try {
        t = await rebuildWindow(payCtx, w);
      } catch {
        continue;
      }
      if (t.indexOf(key) >= 0) {
        const { inputs, publicInputs } = inclusionInputs(ctx, srcTree, srcLeaf, t);
        return { ready: true, mode: "inclusion", claim, payoutWindowIds: [BigInt(w.id)], inputs, publicInputs, deadline, kind: c.kind, expected: c.expected };
      }
    }
    return { ready: false, reason: "payout not attested yet", retryAfterSec: 10 };
  }

  const covering = coveringPayoutWindows(payWindows, c.obligationChainId, p.timestamp, k.clockSkew, deadline);
  if (!covering) return { ready: false, reason: "CRE attestation does not cover the deadline yet", retryAfterSec: 10 };
  const trees = await Promise.all(covering.map((w) => rebuildWindow(payCtx, w)));
  // if a compliant payout exists the circuit is unsatisfiable; complianceInputs still builds a
  // witness and proving fails, which callers surface as "Maker paid"
  const { inputs, publicInputs } = complianceInputs(ctx, srcTree, srcLeaf, trees);
  return { ready: true, mode: "compliance", claim, payoutWindowIds: covering.map((w) => BigInt(w.id)), inputs, publicInputs, deadline, kind: c.kind, expected: c.expected };
}
