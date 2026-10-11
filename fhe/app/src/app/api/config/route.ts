import { NextResponse } from "next/server";
import { config } from "@/lib/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(config());
}
