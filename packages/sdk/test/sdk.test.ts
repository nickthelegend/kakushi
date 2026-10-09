import { describe, expect, it } from "vitest";
import { zeroAddress, decodeFunctionData } from "viem";
import { CHAINS } from "@kakushi/config";
import { Kakushi, buildGross, buildTransferTx, coveringPayoutWindows, describeGross, erc20Abi, sourceRouterAbi, type IndexedWindow, errText } from "../src/index.ts";

const dep = (n: number) => ({ payoutRouter: `0x${"a1".padStart(40, "0")}`, sourceRouter: `0x${"a2".padStart(40, "0")}`, chainId: n }) as never;
const k = new Kakushi({ network: "local", deployments: { network: "local", hub: {} as never, chains: Object.fromEntries(Object.values(CHAINS).map((c) => [c.chainId, dep(c.chainId)])) } as never });
const maker = "0x00000000000000000000000000000000000000aa" as const;
const user = "0x00000000000000000000000000000000000000bb" as const;
const lc = (xs: readonly unknown[] | undefined) => (xs ?? []).map((x) => (typeof x === "string" ? x.toLowerCase() : x));

describe("transfers", () => {
  it("gross carries the destination ident code", () => {
    const { gross, code } = buildGross(5_000_000n, CHAINS.monadTestnet.chainId);
    expect(code).toBe(9001);
    expect(gross).toBe(5_009_001n);
    expect(describeGross(gross)).toEqual({ code: 9001, principal: 5_000_000n });
  });
  it("raw ERC-20 path is a plain transfer to the Maker EOA", () => {
    const tx = buildTransferTx(k, { srcChainId: CHAINS.sepolia.chainId, token: CHAINS.sepolia.usdc.address, maker, gross: 5_009_001n, sender: user });
    expect(tx.to).toBe(CHAINS.sepolia.usdc.address);
    const call = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
    expect(lc(call.args)).toEqual(lc([maker, 5_009_001n]));
  });
  it("raw native path sends value straight to the Maker", () => {
    expect(buildTransferTx(k, { srcChainId: CHAINS.sepolia.chainId, token: zeroAddress, maker, gross: 10n ** 16n + 9003n, sender: user })).toEqual({ to: maker, value: 10n ** 16n + 9003n });
  });
  it("Arbitrum Sepolia and OP Sepolia are addressed by 9004 and 9005", () => {
    expect(buildGross(10n ** 16n, CHAINS.arbitrumSepolia.chainId)).toEqual({ gross: 10n ** 16n + 9004n, code: 9004 });
    expect(buildGross(5_000_000n, CHAINS.opSepolia.chainId)).toEqual({ gross: 5_009_005n, code: 9005 });
    const tx = buildTransferTx(k, { srcChainId: CHAINS.opSepolia.chainId, token: CHAINS.opSepolia.usdc.address, maker, gross: 5_009_001n, sender: user });
    expect(tx.to).toBe(CHAINS.opSepolia.usdc.address);
  });
  it("names an undeployed spoke instead of reading undefined routers", () => {
    const partial = new Kakushi({ network: "local", deployments: { network: "local", hub: {} as never, chains: { 10143: dep(10143), 11155111: dep(11155111) } } as never });
    expect(partial.chains.map((c) => c.key)).toEqual(["monadTestnet", "sepolia"]);
    expect(() => buildTransferTx(partial, { srcChainId: CHAINS.arbitrumSepolia.chainId, token: zeroAddress, maker, gross: 10n ** 16n + 9001n, sender: user, recipient: "0x00000000000000000000000000000000000000cc" })).toThrow("not deployed on Arbitrum Sepolia");
  });
  it("custom recipient goes through SourceRouter with an approval", () => {
    const other = "0x00000000000000000000000000000000000000cc" as const;
    const tx = buildTransferTx(k, { srcChainId: CHAINS.sepolia.chainId, token: CHAINS.sepolia.usdc.address, maker, gross: 5_009_001n, sender: user, recipient: other });
    expect(tx.approve?.amount).toBe(5_009_001n);
    expect(lc(decodeFunctionData({ abi: sourceRouterAbi, data: tx.data! }).args)).toEqual(lc([maker, CHAINS.sepolia.usdc.address, 5_009_001n, other]));
  });
});

describe("window selection mirrors DisputeModule._fillWindows", () => {
  const w = (id: number, from: bigint, to: bigint, ft: bigint, tt: bigint): IndexedWindow => ({ id, chainId: 10143n, kind: 2, fromBlock: from, toBlock: to, fromTime: ft, toTime: tt, root: 1n, leafCount: 0 });
  const ws = [w(1, 1n, 10n, 100n, 109n), w(2, 11n, 20n, 110n, 119n), w(3, 21n, 30n, 120n, 129n), w(4, 31n, 40n, 130n, 139n)];
  it("chooses contiguous windows from srcTime - skew to the deadline", () => {
    expect(coveringPayoutWindows(ws, 10143, 115n, 10n, 135n)!.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(coveringPayoutWindows(ws, 10143, 125n, 10n, 128n)!.map((x) => x.id)).toEqual([2, 3]);
  });
  it("returns null until attestation covers the deadline, or on a gap", () => {
    expect(coveringPayoutWindows(ws, 10143, 125n, 10n, 150n)).toBeNull();
    expect(coveringPayoutWindows([ws[0]!, ws[2]!], 10143, 105n, 0n, 125n)).toBeNull();
  });
});

describe("errText", () => {
  it("includes the node's reason", () => {
    expect(errText({ shortMessage: "Transaction creation failed.", details: "insufficient funds" })).toBe("Transaction creation failed.: insufficient funds");
  });
});
