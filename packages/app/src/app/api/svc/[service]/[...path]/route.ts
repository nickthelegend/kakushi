import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

/** Proxy to Kakushi services (makers by index, watchtower, attester) so the UI has one origin. */
async function forward(req: Request, ctx: { params: Promise<{ service: string; path: string[] }> }) {
  const { service, path } = await ctx.params;
  const cfg = runtimeConfig();
  let base: string | null = null;
  if (service === "watchtower") base = cfg.services.watchtower;
  else if (service === "indexer") base = cfg.services.indexer;
  else if (service === "attester") base = cfg.services.attester;
  else if (service === "relayer") base = cfg.services.relayer;
  else if (service.startsWith("maker-")) base = cfg.makers[Number(service.slice(6))]?.url ?? null;
  if (!base) return NextResponse.json({ error: `${service} is not configured` }, { status: 503 });
  const url = `${base.replace(/\/$/, "")}/${path.join("/")}${new URL(req.url).search}`;
  try {
    const r = await fetch(url, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "GET" ? undefined : await req.text(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: `${service} unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
