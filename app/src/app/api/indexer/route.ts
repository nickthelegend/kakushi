// Server-side proxy to the Fhish Pay indexer (Envio HyperIndex, Hasura GraphQL).
//   GET  /api/indexer           -> the activity dashboard snapshot (stats + live feed)
//   POST /api/indexer {query}   -> any read-only GraphQL query, forwarded as-is
// FHISH_INDEXER_URL: the indexer's GraphQL endpoint (Envio Cloud URL in production).
// No admin secret is ever sent: the indexer's public role is read-only.
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

const indexerUrl = () => process.env.FHISH_INDEXER_URL ?? "http://localhost:8892/v1/graphql";

const DASHBOARD = `query Dashboard {
  chain_metadata { chain_id block_height latest_processed_block num_events_processed is_hyper_sync timestamp_caught_up_to_head_or_endblock }
  GlobalStats {
    payments pays payrollPayments linkClaims transfers uniquePayers accounts
    payrollRuns payrollRunsViaOperator
    linksCreated linksClaimed linksRefunded linksOpen linkClaimAvgSeconds linkClaimMedianSeconds
    wraps unwrapsRequested unwrapsSettled publicWrapped publicUnwrapped publicTvl
    reveals revealsFulfilled revealsPending revealsViaCre revealsViaRelayer revealCallbacksFailed revealAvgLatencySeconds revealAvgLatencyBlocks
    fheOps fheSelects fheInputsVerified fheTrivialEncrypts lastBlock lastUpdatedAt
  }
  Token { id symbol underlyingSymbol decimals publicTvl publicWrapped publicUnwrapped payments wraps unwrapsSettled }
  Payment(order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: 25) {
    id kind amountHandle ref blockNumber timestamp txHash from_id to_id token { symbol } payrollRun { count viaOperator }
  }
  PayLink(order_by: { createdAt: desc }, limit: 8) { id linkId state sender_id claimedBy_id createdAt claimSeconds amountHandle }
  Reveal(order_by: { requestedBlock: desc }, limit: 8) { id requestId app handlesCount status path latencySeconds latencyBlocks callbackOk requestedAt }
  Unwrap(order_by: { requestedBlock: desc }, limit: 5) { id account_id settled amount settleSeconds burnedHandle token { symbol decimals } }
  FheOpStat(order_by: { count: desc }) { name count scalarCount }
  DailyStats(order_by: { dayStart: desc }, limit: 14) { date payments uniquePayers payrollRuns linksClaimed reveals fheOps }
}`;

async function forward(body: string) {
  try {
    const r = await fetch(indexerUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
  } catch (e) {
    return NextResponse.json(
      { error: `Fhish Pay indexer unreachable at ${indexerUrl()} (${(e as Error).message}). Start it with: cd indexer && pnpm start (see indexer/README.md).` },
      { status: 502 },
    );
  }
}

export async function GET() {
  return forward(JSON.stringify({ query: DASHBOARD }));
}

export async function POST(req: Request) {
  let payload: { query?: unknown; variables?: unknown; operationName?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body {query, variables}" }, { status: 400 });
  }
  if (typeof payload.query !== "string" || /^\s*(mutation|subscription)\b/i.test(payload.query)) {
    return NextResponse.json({ error: "only GraphQL queries are proxied" }, { status: 400 });
  }
  return forward(JSON.stringify({ query: payload.query, variables: payload.variables ?? {}, operationName: payload.operationName }));
}
