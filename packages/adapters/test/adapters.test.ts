import { describe, expect, it } from "vitest";
import { zeroAddress,encodeEventTopics,encodeAbiParameters } from "viem";
import { CHAINS } from "@kakushi/config";
import { Kakushi,erc20Abi } from "@kakushi/sdk";
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


it("selects proof input for a requested batch log index", async()=>{
  const maker="0x00000000000000000000000000000000000000aa" as const;
  const sender="0x00000000000000000000000000000000000000bb" as const;
  const hash=`0x${"12".repeat(32)}` as const;
  const logs=[2,5].map(logIndex=>({address:CHAINS.sepolia.usdc.address,logIndex,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:sender,to:maker}}),data:encodeAbiParameters([{type:"uint256"}],[BigInt(logIndex)*10000n+9001n])}));
  const client={getTransaction:async()=>({from:sender,to:CHAINS.sepolia.usdc.address,input:"0x1234",value:0n}),getTransactionReceipt:async()=>({status:"success",blockNumber:10n,logs}),getBlock:async()=>({timestamp:100n})};
  const k={network:"local",d:fakeDeployments,client:()=>client,clientById:()=>client,makers:async()=>[maker]} as unknown as Kakushi;
  const a=new EvmAdapter(k,"sepolia");
  const first=await a.getProofInputs(hash,2);
  const second=await a.getProofInputs(hash,5);
  expect(first).not.toEqual(second);
  expect(await a.getProofInputs(hash)).toEqual(first);
  expect(await a.getProofInputs(hash,99)).toBeNull();
});
