import { describe, expect, it } from "vitest";
import { fetchLogs } from "../src/attestations.ts";

// Monad's public RPC refuses eth_getLogs over more than 100 blocks; attested windows can be longer.
describe("fetchLogs", () => {
  it("pages a long window in 100-block ranges and keeps every log", async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
        const from = BigInt(params[0].fromBlock);
        const to = BigInt(params[0].toBlock);
        if (to - from + 1n > 100n) throw new Error("eth_getLogs is limited to a 100 range");
        ranges.push([from, to]);
        return from <= 1150n && 1150n <= to ? [{ address: "0x1", topics: [], data: "0x", blockNumber: "0x47e", transactionHash: "0xab", logIndex: "0x0", removed: false }] : [];
      },
    };
    const cfg = { chainId: 10143, payoutRouter: "0x0000000000000000000000000000000000000001", sourceRouter: "0x0000000000000000000000000000000000000002", tokens: [], makers: [] };
    const logs = await fetchLogs({ cfg, client } as never, 1000n, 1349n);
    const perFilter = ranges.filter(([f]) => f === 1000n).length;
    expect(ranges.slice(0, ranges.length / perFilter)).toEqual([[1000n, 1099n], [1100n, 1199n], [1200n, 1299n], [1300n, 1349n]]);
    expect(logs.filter((l) => l.blockNumber === 1150n).length).toBe(perFilter);
  });
});
