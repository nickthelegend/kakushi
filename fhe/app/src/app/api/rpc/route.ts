import { NextResponse } from "next/server";
import { rpcUrl } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const r = await fetch(rpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), cache: "no-store" });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `rpc unreachable: ${(e as Error).message}` } }, { status: 502 });
  }
}
