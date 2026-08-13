// Twilio call-status callbacks: mark the call/reservation finished.

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { parseTwilioForm, validateTwilioSignature } from "@/lib/twilioClient";
import {
  loadCall,
  saveCall,
  loadReservation,
  saveReservation,
  backfillTranslations,
} from "@/lib/callEngine";
import { sendConfirmation } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId") ?? "";
  const form = await parseTwilioForm(request);
  const fullUrl = `${config.baseUrl}/api/twilio/status?callId=${encodeURIComponent(callId)}`;
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), fullUrl, form)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const call = await loadCall(callId);
  if (!call) return NextResponse.json({ ok: true });

  const callStatus = form.CallStatus;
  if (callStatus === "completed" || callStatus === "failed" || callStatus === "no-answer" || callStatus === "busy") {
    call.status =
      callStatus === "completed" ? "completed" : callStatus === "no-answer" ? "no_answer" : "failed";
    call.endedAt = new Date().toISOString();
    await saveCall(call);

    const reservation = await loadReservation(call.reservationId);
    if (reservation && reservation.status === "calling") {
      reservation.status = call.status === "completed" && reservation.outcome ? "completed" : "completed";
      if (!reservation.outcome) {
        reservation.outcome = {
          success: false,
          summary:
            call.status === "completed"
              ? "Call ended without an explicit confirmation — review the transcript."
              : `Call ${call.status.replace("_", " ")}.`,
        };
      }
      await saveReservation(reservation);
    }

    // Email the requester the outcome + transcript (with English glosses).
    try {
      const translated = await backfillTranslations(call);
      await sendConfirmation(call.reservationId, translated);
    } catch (err) {
      console.error("Confirmation send failed:", err);
    }
  }
  return NextResponse.json({ ok: true });
}
