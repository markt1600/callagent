import { NextRequest, NextResponse } from "next/server";
import { listJSON } from "@/lib/store";
import type { CallSession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const reservationId = request.nextUrl.searchParams.get("reservationId");
  let calls = await listJSON<CallSession>("call:");
  if (reservationId) calls = calls.filter((c) => c.reservationId === reservationId);
  calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return NextResponse.json({ calls });
}
