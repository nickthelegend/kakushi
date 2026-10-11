import { NextResponse } from "next/server";
import { gatewayUrl } from "@/lib/server";
export const dynamic = "force-dynamic";

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  try {
    const r = await fetch(`${gatewayUrl()}/${path.join("/")}`, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    return new NextResponse(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: `Kakushi gateway unreachable (${(e as Error).message}). Start it with node scripts/e2e-local.ts --keep.` }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
