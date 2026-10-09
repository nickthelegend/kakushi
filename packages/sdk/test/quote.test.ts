import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAINS } from "@kakushi/config";
import { Kakushi, type Classification } from "../src/kakushi.ts";
import type { MakerQuote } from "../src/types.ts";

const maker = "0x00000000000000000000000000000000000000aa" as const;
const pairId = `0x${"ab".repeat(32)}` as const;
const quote: MakerQuote = {
  maker, pairId, name: "Healthy Maker", srcChainId: 11155111, dstChainId: 10143,
  srcToken: CHAINS.sepolia.usdc.address, dstToken: CHAINS.monadTestnet.usdc.address,
  identCode: 9001, gross: "5009001", principal: "5000000", net: "4945050",
  withholdingFee: "50000", tradingFee: "4950", minAmount: "1000000", maxAmount: "500000000",
  inventory: "100000000", margin: "600000000", marginRequired: "550000000", quotable: true, etaMs: 1000,
};
const args = { srcChainId: 11155111, dstChainId: 10143, token: "USDC" as const, amount: 5_000_000n, makerUrls: ["https://bad.test", "https://good.test"] };
const classification = { kind: 1, expected: 4_945_050n, obligationChainId: 10143, payToken: quote.dstToken, pairId } as Classification;
function client(bad: unknown, c = classification) {
  const k = new Kakushi({ network: "local", deployments: { hub: {}, chains: {} } as never });
  vi.spyOn(k, "classify").mockResolvedValue(c);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith("https://bad.test") ? bad : quote))));
  return k;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("untrusted Maker quotes", () => {
  it.each([
    { ...quote, gross: "100009001", principal: "100000000" },
    { ...quote, dstChainId: 84532, identCode: 9003, gross: "5009003" },
    { ...quote, srcToken: CHAINS.monadTestnet.usdc.address },
    { ...quote, dstToken: CHAINS.sepolia.usdc.address },
    { ...quote, net: "not-a-number" },
    { ...quote, etaMs: -1 },
    { error: "no route" },
  ])("keeps healthy peer quotes when another response changes the requested transfer or is malformed", async (bad) => {
    expect(await client(bad).quote(args)).toEqual([quote]);
  });
  it("refuses a hub destination mismatch even when the net matches", async () => {
    const result = await client({ error: "offline" }, { ...classification, obligationChainId: 84532 }).quote(args);
    expect(result).toHaveLength(1);
    expect(result[0]?.quotable).toBe(false);
  });
  it("one classification failure cannot suppress another Maker", async () => {
    const k = client({ ...quote, name: "Unreachable Maker" });
    vi.mocked(k.classify).mockRejectedValueOnce(new Error("RPC failed"));
    expect(await k.quote(args)).toEqual([quote]);
  });
});
