import { NextResponse } from "next/server";
import { rpcFor } from "@/lib/server-config";

export const dynamic = "force-dynamic";

/** JSON-RPC proxy: the browser talks to one origin; provider keys stay server-side. */
export async function POST(req: Request, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await ctx.params;
  const url = rpcFor(Number(chainId));
  if (!url) return NextResponse.json({ error: `unknown chain ${chainId}` }, { status: 404 });
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `rpc unreachable: ${(e as Error).message}` } }, { status: 502 });
  }
}
