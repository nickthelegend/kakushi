import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Status of the CRE delivery layer (local runner on the fork; labelled NOT a Chainlink DON).
export async function GET() {
  const url = process.env.KAKUSHI_FHE_CRE_STATUS_URL ?? "http://127.0.0.1:8891/status";
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: "CRE runner not running (node scripts/e2e-local.ts --keep --deliver cre)" }, { status: 502 });
  }
}
