import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAIN_LIST, chainByIdentCode, COMPLIANT_LANE, rpcUrl, CHAINS } from "../chains.ts";

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

});
