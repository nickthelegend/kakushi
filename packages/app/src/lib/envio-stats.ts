export interface ObservedMakerStats {
  maker: string;
  fills: number;
  refunds: number;
  disputesLost: number;
  p50LatencyMs: number | null;
}
export interface ObservedRouteStats {
  pairId: string;
  observedSources: number;
  fills: number;
  refunds: number;
  p50LatencyMs: number | null;
}

const address = /^0x[0-9a-f]{40}$/i;
const pairId = /^0x[0-9a-f]{64}$/i;
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Envio observation count");
  return value;
}
function latency(value: unknown): number | null {
  return value === null ? null : count(value);
}
const QUERY = `query KakushiMarketStats {
  MakerStats(order_by: {id: asc}, limit: 200) { id filled refunded slashed p50LatencyMs }
  RouteStats(order_by: {id: asc}, limit: 200) { id observedSources filled refunded p50LatencyMs }
}`;

/** Read-only GraphQL observations. A successful query does not assert indexer catch-up or chain finality. */
export async function readEnvioStats(endpoint: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY }), cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Envio statistics unavailable");
  const result = await response.json();
  if (result.errors?.length || !Array.isArray(result.data?.MakerStats) || !Array.isArray(result.data?.RouteStats)) throw new Error("Envio statistics unavailable");
  const makers: ObservedMakerStats[] = result.data.MakerStats.map((row: Record<string, unknown>) => {
    if (typeof row.id !== "string" || !address.test(row.id)) throw new Error("Invalid Envio Maker identity");
    return { maker: row.id.toLowerCase(), fills: count(row.filled), refunds: count(row.refunded), disputesLost: count(row.slashed), p50LatencyMs: latency(row.p50LatencyMs) };
  });
  const routes: ObservedRouteStats[] = result.data.RouteStats.map((row: Record<string, unknown>) => {
    if (typeof row.id !== "string" || !pairId.test(row.id)) throw new Error("Invalid Envio route identity");
    return { pairId: row.id.toLowerCase(), observedSources: count(row.observedSources), fills: count(row.filled), refunds: count(row.refunded), p50LatencyMs: latency(row.p50LatencyMs) };
  });
  return { source: "envio" as const, makers, routes, limit: 200, possiblyTruncated: makers.length === 200 || routes.length === 200 };
}
