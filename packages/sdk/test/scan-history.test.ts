import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { encodeStealthMetadata, erc5564AnnouncerAbi, generateStealthAddress, generateStealthKeys, scanAnnouncements } from "../src/stealth.ts";

const announcer = "0x7030628079Ce422c905DD819ba6ad95B562d66Aa" as Hex;
const caller = "0x2c76aA36C88E89734223A5Cf0c54697782B9C24C" as Hex;

describe("scanAnnouncements with an indexer history", () => {
  it("matches indexer logs and reads only the blocks after the indexer's height over RPC", async () => {
    const keys = generateStealthKeys(`0x${"11".repeat(65)}`);
    const g = generateStealthAddress(keys.metaAddress);
    const topics = encodeEventTopics({ abi: erc5564AnnouncerAbi, eventName: "Announcement", args: { schemeId: 1n, stealthAddress: g.stealthAddress, caller } }) as Hex[];
    const data = encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [g.ephemeralPublicKey, encodeStealthMetadata({ viewTag: g.viewTag })]);
    const ranges: [bigint, bigint][] = [];
    const client = { getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => (ranges.push([fromBlock, toBlock]), []) };
    const found = await scanAnnouncements(client as never, announcer, 1000n, 5150n, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey }, {
      history: async (from) => (expect(from).toBe(1000n), { logs: [{ blockNumber: 1234n, transactionHash: `0x${"ab".repeat(32)}`, logIndex: 3, topics, data }], toBlock: 5000n }),
    });
    expect(found.map((m) => [m.stealthAddress.toLowerCase(), m.blockNumber, m.logIndex])).toEqual([[g.stealthAddress.toLowerCase(), 1234n, 3]]);
    expect(ranges).toEqual([[5001n, 5100n], [5101n, 5150n]]);
  });

  it("falls back to RPC for the whole range when the history source fails", async () => {
    const keys = generateStealthKeys(`0x${"22".repeat(65)}`);
    const ranges: bigint[] = [];
    const client = { getLogs: async ({ fromBlock }: { fromBlock: bigint }) => (ranges.push(fromBlock), []) };
    await scanAnnouncements(client as never, announcer, 0n, 250n, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey }, { history: async () => { throw new Error("down"); } });
    expect(ranges).toEqual([0n, 100n, 200n]);
  });
});
