import { expect, it } from "vitest";
import { readEnvioStats } from "../src/lib/envio-stats";

const maker = `0x${"A".repeat(40)}`;
const route = `0x${"B".repeat(64)}`;
function result(p50LatencyMs: unknown = null) {
  return { data: { MakerStats: [{ id: maker, filled: 6, refunded: 1, slashed: 2, p50LatencyMs }], RouteStats: [{ id: route, observedSources: 7, filled: 6, refunded: 1, p50LatencyMs }] } };
}
it("reads actual GraphQL query roots and maps observed counts without inventing missing latency", async () => {
  let query = "";
  const stats = await readEnvioStats("https://indexer.test/graphql", async (_url, init) => {
    query = JSON.parse(String(init?.body)).query;
    return Response.json(result());
  });
  expect(query).toContain("MakerStats(order_by:");
  expect(query).toContain("RouteStats(order_by:");
  expect(stats.makers[0]).toEqual({ maker: maker.toLowerCase(), fills: 6, refunds: 1, disputesLost: 2, p50LatencyMs: null });
  expect(stats.routes[0]?.pairId).toBe(route.toLowerCase());
  expect(stats.possiblyTruncated).toBe(false);
});
it("retains an observed zero latency", async () => {
  expect((await readEnvioStats("https://indexer.test", async () => Response.json(result(0)))).makers[0]?.p50LatencyMs).toBe(0);
});
it("distinguishes an observed empty dataset from HTTP, GraphQL and malformed data", async () => {
  expect((await readEnvioStats("https://indexer.test", async () => Response.json({ data: { MakerStats: [], RouteStats: [] } }))).makers).toEqual([]);
  for (const body of [{}, { errors: [{ message: "denied" }] }, result(-1)]) {
    await expect(readEnvioStats("https://indexer.test", async () => Response.json(body))).rejects.toThrow();
  }
  await expect(readEnvioStats("https://indexer.test", async () => new Response("", { status: 503 }))).rejects.toThrow("unavailable");
});
