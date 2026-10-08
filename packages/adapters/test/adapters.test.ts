import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { CHAINS } from "@kakushi/config";
import { Kakushi } from "@kakushi/sdk";
import { EvmAdapter, SolanaAdapterStub } from "../src/index.ts";

const fakeDeployments = {
  network: "local",
  hub: { payoutRouter: "0x1", sourceRouter: "0x2" },
  chains: Object.fromEntries(Object.values(CHAINS).map((c) => [c.chainId, { payoutRouter: "0x00000000000000000000000000000000000000a1", sourceRouter: "0x00000000000000000000000000000000000000a2" }])),
} as never;

describe("IChainAdapter", () => {
  const k = new Kakushi({ network: "local", deployments: fakeDeployments });
  it("one adapter per chain from config alone (adding a chain = config + adapter)", () => {
    for (const key of Object.keys(CHAINS) as (keyof typeof CHAINS)[]) {
      const a = new EvmAdapter(k, key);
      expect(a.chainId).toBe(CHAINS[key].chainId);
      expect(a.vmKind).toBe("evm");
    }
  });
  it("encodes native and ERC-20 payments with the code in the amount", () => {
    const a = new EvmAdapter(k, "sepolia");
    const maker = "0x00000000000000000000000000000000000000aa";
    expect(a.encodePayment(maker, zeroAddress, 10_000_000_000_009_003n, 9003)).toEqual({ to: maker, value: 10_000_000_000_009_003n });
    const erc = a.encodePayment(maker, CHAINS.sepolia.usdc.address, 100_009_001n, 9001);
    expect(erc.to).toBe(CHAINS.sepolia.usdc.address);
    expect(erc.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(() => a.encodePayment(maker, zeroAddress, 100_009_000n, 9001)).toThrow();
  });
  it("Solana stub shares the encoding idea and refuses to touch a network", async () => {
    const s = new SolanaAdapterStub(1399811149);
    expect(s.vmKind).toBe("solana");
    expect(s.encodePayment("Maker111", "SOL", 1_000_009_001n, 9001).value).toBe(1_000_009_001n);
    await expect(s.submitPayout()).rejects.toThrow(/stub/);
  });
});
