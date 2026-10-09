import { afterEach, expect, it, vi } from "vitest";
import { network, rpcFor, runtimeConfig, publicRuntimeConfig } from "../src/lib/server-config";

afterEach(() => vi.unstubAllEnvs());
it("does not send local dev signatures to an inherited public provider", () => {
  vi.stubEnv("KAKUSHI_NETWORK", "local");
  vi.stubEnv("MONAD_TESTNET_RPC_URL", "https://example.test/rpc");
  expect(rpcFor(10143)).toBe("http://127.0.0.1:18710");
});
it("testnet has no local keys and honors explicit provider configuration", () => {
  vi.stubEnv("KAKUSHI_NETWORK", "testnet");
  vi.stubEnv("MONAD_TESTNET_RPC_URL", "https://example.test/rpc");
  expect(rpcFor(10143)).toBe("https://example.test/rpc");
  expect(runtimeConfig().localDevKeys).toEqual([]);
});
it("refuses a misspelled network instead of silently selecting local signing", () => {
  vi.stubEnv("KAKUSHI_NETWORK", "tesnet");
  expect(network).toThrow("local or testnet");
});
it("defaults a production build to testnet without public demo keys", () => {
  vi.stubEnv("KAKUSHI_NETWORK", undefined);
  vi.stubEnv("NODE_ENV", "production");
  expect(network()).toBe("testnet");
  expect(runtimeConfig().localDevKeys).toEqual([]);
});
it("rejects an explicit local network on a hosted deployment", () => {
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "release");
  vi.stubEnv("KAKUSHI_NETWORK", "local");
  expect(network).toThrow("Hosted Kakushi must use testnet");
});
it("keeps explicitly configured local production demos available off-host", () => {
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", undefined);
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("KAKUSHI_NETWORK", "local");
  expect(network()).toBe("local");
});
it("exposes proxy paths instead of server service credentials", () => {
  vi.stubEnv("KAKUSHI_NETWORK", "testnet");
  vi.stubEnv("KAKUSHI_INDEXER_URL", "https://indexer.test/?token=server-only");
  vi.stubEnv("KAKUSHI_ENVIO_GRAPHQL_URL", "https://graphql.test/?token=server-only");
  const cfg = publicRuntimeConfig();
  expect(cfg.services.indexer).toBe("/api/svc/indexer");
  expect(cfg.envioStatsEnabled).toBe(true);
  expect(JSON.stringify(cfg)).not.toContain("server-only");
});
it("uses the public provider when an optional testnet override is blank", () => {
  vi.stubEnv("KAKUSHI_NETWORK", "testnet");
  vi.stubEnv("MONAD_TESTNET_RPC_URL", "");
  expect(rpcFor(10143)).toBe("https://testnet-rpc.monad.xyz");
});
