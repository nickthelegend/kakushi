// KMS reveals: request -> k-of-n signed result -> on-chain callback. We index the round trip
// (who asked, how many handles, how it was delivered, how long it took), never the cleartexts.
import { indexer, type Reveal } from "envio";
import { lc, revealId, tokenLabel } from "../lib/common";
import { Unit } from "../lib/unit";
import { CRE_FORWARDER } from "../network.generated";

const TX = { transaction: ["hash"], block: ["timestamp"] } as const;

indexer.onEvent({ contract: "KakushiDecryptionOracle", event: "DecryptionRequested", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const requester = lc(event.params.requester);
  const reveal: Reveal = {
    id: revealId(event.chainId, event.params.requestId),
    chainId: event.chainId,
    requestId: event.params.requestId,
    requester,
    app: tokenLabel(requester) ?? "app",
    handlesCount: event.params.handles.length,
    callback: lc(event.params.callback),
    status: "PENDING",
    requestedBlock: event.block.number,
    requestedAt: event.block.timestamp,
    requestTx: lc(event.transaction.hash),
    fulfilledBlock: undefined,
    fulfilledAt: undefined,
    fulfillTx: undefined,
    latencyBlocks: undefined,
    latencySeconds: undefined,
    via: undefined,
    path: undefined,
    callbackOk: undefined,
  };
  context.Reveal.set(reveal);
  const g = await u.global();
  g.reveals += 1;
  g.revealsPending += 1;
  (await u.day()).reveals += 1;
  u.flush();
});

indexer.onEvent({ contract: "KakushiDecryptionOracle", event: "DecryptionFulfilled", fields: TX }, async ({ event, context }) => {
  const r = await context.Reveal.get(revealId(event.chainId, event.params.requestId));
  if (!r) {
    context.log.warn(`DecryptionFulfilled for unknown request ${event.params.requestId} (requested before the start block)`);
    return;
  }
  if (r.status === "FULFILLED") return;
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const via = lc(event.params.via);
  const path = CRE_FORWARDER && via === CRE_FORWARDER ? "CRE" : "RELAYER";
  const latencyBlocks = event.block.number - r.requestedBlock;
  const latencySeconds = event.block.timestamp - r.requestedAt;
  // event.params.cleartexts is intentionally ignored: no decrypted value is stored by this indexer
  context.Reveal.set({
    ...r,
    status: "FULFILLED",
    fulfilledBlock: event.block.number,
    fulfilledAt: event.block.timestamp,
    fulfillTx: lc(event.transaction.hash),
    latencyBlocks,
    latencySeconds,
    via,
    path,
    callbackOk: event.params.callbackOk,
  });
  const g = await u.global();
  g.revealsFulfilled += 1;
  g.revealsPending -= 1;
  if (path === "CRE") g.revealsViaCre += 1;
  else g.revealsViaRelayer += 1;
  if (!event.params.callbackOk) g.revealCallbacksFailed += 1;
  g.revealLatencySecondsTotal += latencySeconds;
  g.revealLatencyBlocksTotal += latencyBlocks;
  g.revealAvgLatencySeconds = g.revealLatencySecondsTotal / g.revealsFulfilled;
  g.revealAvgLatencyBlocks = g.revealLatencyBlocksTotal / g.revealsFulfilled;
  const d = await u.day();
  d.revealsFulfilled += 1;
  d.revealLatencySecondsTotal += latencySeconds;
  u.flush();
});
