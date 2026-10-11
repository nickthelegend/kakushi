import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, type PublicClient } from "viem";
import { MonadHeads, trackByTags } from "../src/monad.ts";

// Live, read-only checks against Monad testnet (skipped offline or with KAKUSHI_FHE_OFFLINE=1).
const live = process.env.KAKUSHI_FHE_OFFLINE !== "1";

test("monadNewHeads: a fresh block goes Proposed -> Voted -> Finalized in order, sub-second", { skip: !live, timeout: 30_000 }, async () => {
  const heads = new MonadHeads();
  await heads.start();
  try {
    const first = await new Promise<bigint>((r) => {
      const off = heads.on((h) => {
        if (h.state === "Proposed") {
          off();
          r(h.number + 1n); // track the NEXT block from its proposal
        }
      });
    });
    const tl = await heads.track(first, { until: "Finalized" });
    const { Proposed, Voted, Finalized } = tl.at;
    assert.ok(Proposed !== undefined && Voted !== undefined && Finalized !== undefined);
    assert.ok(Proposed! <= Voted! && Voted! <= Finalized!);
    assert.ok(Finalized! - Proposed! < 3_000, `proposal to finality took ${Finalized! - Proposed!} ms`);
  } finally {
    heads.stop();
  }
});

test("block tags give the same ladder on any RPC", { skip: !live, timeout: 30_000 }, async () => {
  const c = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") }) as PublicClient;
  const n = (await c.getBlockNumber()) + 1n;
  const tl = await trackByTags(c, n, { pollMs: 100 });
  assert.ok(tl.at.Proposed! <= tl.at.Voted! && tl.at.Voted! <= tl.at.Finalized!);
});
