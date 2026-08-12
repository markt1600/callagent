// Place the actual phone call, in one of two modes:
//   "agent" — ElevenLabs Conversational AI handles the realtime loop (recommended)
//   "ivr"   — self-hosted cached-audio loop via Twilio TwiML webhooks

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getJSON, setJSON } from "@/lib/store";
import { placeAgentCall } from "@/lib/elevenlabsAgent";
import { placeIvrCall } from "@/lib/twilioClient";
import type { CallSession, ReservationRequest } from "@/lib/types";

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

  if (mode === "ivr" && !reservation.phrasePack) {
    return NextResponse.json(
      { error: "IVR mode requires a prepared phrase pack — run prepare first" },
      { status: 400 },
    );
  }

  const call: CallSession = {
    id: randomUUID().slice(0, 8),
    reservationId: reservation.id,
    mode,
    status: "dialing",
    startedAt: new Date().toISOString(),
    turns: [],
    relayActive: false,
    unmatchedStreak: 0,
  };

  try {
    if (mode === "agent") {
      const result = await placeAgentCall(reservation);
      call.elevenLabsConversationId = result.conversationId;
      call.twilioCallSid = result.callSid;
    } else {
      call.twilioCallSid = await placeIvrCall(reservation.phoneNumber, call.id);
    }
    call.status = "in_progress";
    reservation.status = "calling";
  } catch (err) {
    call.status = "failed";
    reservation.status = "failed";
    reservation.error = err instanceof Error ? err.message : String(err);
  }

  await setJSON(`call:${call.id}`, call);
  await setJSON(`res:${reservation.id}`, reservation);

  if (call.status === "failed") {
    return NextResponse.json({ error: reservation.error, call }, { status: 500 });
  }
  return NextResponse.json({ call });
}
