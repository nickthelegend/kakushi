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

  it("reads the optional privacy object tolerantly", () => {
    const dir = mkdtempSync(join(tmpdir(), "kakushi-deployments-"));
    const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
    const privacy = {
      deployBlock: 7,
      stealthRegistry: a(1),
      stealthAnnouncer: a(2),
      stealthPay: a(3),
      shieldedVerifier: a(4),
      poolFactory: a(8),
      pools: {
        "MON-1": { address: a(5), token: a(0), symbol: "MON", decimals: 18, denomination: "1000000000000000000" },
        "USDC-10": { address: a(6), token: a(7), symbol: "USDC", decimals: 6, denomination: "10000000" },
        broken: { address: "nope", token: a(0), denomination: "1" },
      },
    };
    try {
      mkdirSync(join(dir, "local"));
      const base = { deployBlock: 1, deployer: "0x1", payoutRouter: "0x2", sourceRouter: "0x3" };
      writeFileSync(join(dir, "local", "10143.json"), JSON.stringify({ ...base, chainId: 10143, role: "hub", privacy }));
      // a record written before the factory existed (and one with a malformed factory) still parses
      const { poolFactory: _f, ...older } = privacy;
      writeFileSync(join(dir, "local", "11155111.json"), JSON.stringify({ ...base, chainId: 11155111, role: "spoke" }));
      writeFileSync(join(dir, "local", "421614.json"), JSON.stringify({ ...base, chainId: 421614, role: "spoke", privacy: older }));
      writeFileSync(join(dir, "local", "11155420.json"), JSON.stringify({ ...base, chainId: 11155420, role: "spoke", privacy: { ...older, poolFactory: "0x12" } }));
      writeFileSync(join(dir, "local", "84532.json"), JSON.stringify({ ...base, chainId: 84532, role: "spoke", privacy: { stealthPay: "0x" } }));
      const d = loadDeployments("local", dir);
      expect(d.hub.privacy?.stealthPay).toBe(a(3));
      expect(Object.keys(d.hub.privacy!.pools)).toEqual(["MON-1", "USDC-10"]);
      expect(BigInt(d.hub.privacy!.pools["MON-1"]!.denomination)).toBe(10n ** 18n);
      expect(d.chains[11155111]!.privacy).toBeUndefined();
      expect(d.chains[84532]!.privacy).toBeUndefined();
      expect(d.hub.privacy!.poolFactory).toBe(a(8));
      expect(d.chains[421614]!.privacy!.stealthPay).toBe(a(3));
      expect(d.chains[421614]!.privacy!.poolFactory).toBeUndefined();
      expect("poolFactory" in d.chains[11155420]!.privacy!).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
