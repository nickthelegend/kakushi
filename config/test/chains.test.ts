import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAIN_LIST, chainByIdentCode, COMPLIANT_LANE, rpcUrl, CHAINS, deployedChains, OPTIONAL_LOCAL_CHAINS } from "../chains.ts";
import { loadDeployments } from "../deployments.ts";

describe("chain registry", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("has unique chain ids, ident codes and local ports", () => {
    const ids = CHAIN_LIST.map((c) => c.chainId);
    const codes = [...CHAIN_LIST.map((c) => c.identCode), COMPLIANT_LANE.identCode];
    const ports = CHAIN_LIST.map((c) => c.localPort);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(ports).size).toBe(ports.length);
  });
  it("ident codes are 4 digits and never 0000", () => {
    for (const c of CHAIN_LIST) {
      expect(c.identCode).toBeGreaterThan(0);
      expect(c.identCode).toBeLessThan(10_000);
    }
  });
  it("exactly one hub, and it is Monad", () => {
    const hubs = CHAIN_LIST.filter((c) => c.isHub);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.chainId).toBe(10143);
  });
  it("resolves codes and local RPCs", () => {
    expect(chainByIdentCode(9002)?.key).toBe("sepolia");
    expect(rpcUrl(CHAINS.sepolia, "local")).toBe("http://127.0.0.1:18711");
    expect(rpcUrl(CHAINS.sepolia, "testnet")).toContain("sepolia");
  });
  it("rejects inherited public RPCs when using public local accounts", () => {
    vi.stubEnv("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com");
    expect(() => rpcUrl(CHAINS.sepolia, "local")).toThrow("loopback");
    expect(rpcUrl(CHAINS.sepolia, "testnet")).toContain("publicnode.com");
  });
  it("allows an explicit alternate loopback fork port", () => {
    vi.stubEnv("SEPOLIA_RPC_URL", "http://localhost:18711");
    expect(rpcUrl(CHAINS.sepolia, "local")).toBe("http://localhost:18711");
  });
  it("routes 9004 to Arbitrum Sepolia and 9005 to OP Sepolia", () => {
    expect(chainByIdentCode(9004)?.chainId).toBe(421614);
    expect(chainByIdentCode(9005)?.chainId).toBe(11155420);
    expect(rpcUrl(CHAINS.arbitrumSepolia, "local")).toBe("http://127.0.0.1:18713");
    expect(rpcUrl(CHAINS.opSepolia, "local")).toBe("http://127.0.0.1:18714");
    vi.stubEnv("OP_SEPOLIA_RPC_URL", "https://op.example");
    expect(rpcUrl(CHAINS.opSepolia, "testnet")).toBe("https://op.example");
    expect(OPTIONAL_LOCAL_CHAINS.every((k) => !CHAINS[k].isHub)).toBe(true);
  });
  it("loads the hub plus whichever spokes have a deployment record", () => {
    const dir = mkdtempSync(join(tmpdir(), "kakushi-deployments-"));
    try {
      mkdirSync(join(dir, "local"));
      const rec = (chainId: number, role: string) =>
        writeFileSync(join(dir, "local", `${chainId}.json`), JSON.stringify({ chainId, role, deployBlock: 1, deployer: "0x1", payoutRouter: "0x2", sourceRouter: "0x3" }));
      expect(() => loadDeployments("local", dir)).toThrow("missing deployment");
      rec(10143, "hub");
      expect(() => loadDeployments("local", dir)).toThrow("no spoke deployment");
      rec(11155111, "spoke");
      rec(84532, "spoke");
      const d = loadDeployments("local", dir);
      expect(deployedChains(d).map((c) => c.key)).toEqual(["monadTestnet", "sepolia", "baseSepolia"]);
      rec(11155420, "spoke");
      expect(deployedChains(loadDeployments("local", dir)).map((c) => c.key)).toEqual(["monadTestnet", "sepolia", "baseSepolia", "opSepolia"]);
      rec(421614, "hub");
      expect(() => loadDeployments("local", dir)).toThrow("has role hub");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
