import { NextResponse } from "next/server";
import { network } from "@/lib/server-config";

export const dynamic = "force-dynamic";

/** Process/configuration liveness only; contract, Maker and sponsor readiness is separate. */
export function GET() {
  try {
    return NextResponse.json({ status: "ok", network: network(), scope: "application-liveness" });
  } catch {
    return NextResponse.json({ status: "unavailable", error: "Invalid hosting network configuration" }, { status: 503 });
  }
}
