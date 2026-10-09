import { NextResponse } from "next/server";
import { readEnvioStats } from "@/lib/envio-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const endpoint = process.env.KAKUSHI_ENVIO_GRAPHQL_URL;
  if (!endpoint) return NextResponse.json({ error: "Envio statistics are not configured" }, { status: 503 });
  try {
    return NextResponse.json(await readEnvioStats(endpoint));
  } catch {
    return NextResponse.json({ error: "Envio statistics unavailable" }, { status: 502 });
  }
}
