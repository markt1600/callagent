// Manually (re)place the phone call for a reservation.
//   "agent" (default) — ElevenLabs Conversational AI handles the realtime loop
//   "ivr"             — self-hosted cached-audio loop (requires prepared phrases)

import { NextRequest, NextResponse } from "next/server";
import { getJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const mode: "agent" | "ivr" = body.mode === "ivr" ? "ivr" : "agent";

  const { call } = await dispatchCall(reservation, mode);
  if (call.status === "failed") {
    return NextResponse.json({ error: reservation.error, call }, { status: 500 });
  }
  return NextResponse.json({ call });
}
