import { describe, expect, it } from "vitest";
import { TxSpacer } from "../src/spacing.ts";

/** A fake chain: the head advances one block per 400 ms of fake time. */
function fake() {
  let t = 0;
  const head = () => BigInt(Math.floor(t / 400));
  return {
    now: () => t,
    sleep: async (ms: number) => void (t += ms),
    blockNumber: async () => head(),
    mine: async () => ({ blockNumber: head() }),
    time: () => t,
  };
}

describe("TxSpacer (Monad reserve rule)", () => {
  it("spaces value sends >= 3 blocks and >= 1.2 s after the previous tx", async () => {
    const f = fake();
    const s = new TxSpacer({ blocks: 3n, ms: 1200, blockNumber: f.blockNumber, now: f.now, sleep: f.sleep, pollMs: 100 });
    const blocks: bigint[] = [];
    await Promise.all([1n, 1n, 0n, 1n].map((v) => s.run(v, async () => { const r = await f.mine(); blocks.push(r.blockNumber); return r; })));
    // first value send immediately; second waits 3 blocks; the zero-value send needs no gap; the
    // next value send waits 3 blocks after that zero-value send
    expect(blocks).toEqual([0n, 3n, 3n, 6n]);
  });

  it("does not delay zero-value sends and can be disabled", async () => {
    const f = fake();
    const s = new TxSpacer({ blocks: 0n, ms: 0, blockNumber: f.blockNumber, now: f.now, sleep: f.sleep });
    for (let i = 0; i < 3; i++) await s.run(1n, f.mine);
    expect(f.time()).toBe(0);
  });

  it("keeps the queue going after a failed send", async () => {
    const f = fake();
    const s = new TxSpacer({ blocks: 3n, ms: 1200, blockNumber: f.blockNumber, now: f.now, sleep: f.sleep });
    await expect(s.run(1n, async () => { throw new Error("reverted"); })).rejects.toThrow("reverted");
    await expect(s.run(1n, f.mine)).resolves.toEqual({ blockNumber: 0n });
  });
});
