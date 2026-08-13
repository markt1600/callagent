// Initial TwiML for IVR-mode calls: play the pre-rendered greeting (which
// states the full reservation request), then listen.

import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import {
  buildTwiml,
  twimlResponse,
  parseTwilioForm,
  validateTwilioSignature,
} from "@/lib/twilioClient";
import { loadCall, saveCall, loadReservation, phraseByCategory } from "@/lib/callEngine";
import { speechLocaleFor } from "@/lib/locale";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId") ?? "";
  const form = await parseTwilioForm(request);
  const fullUrl = `${config.baseUrl}/api/twilio/voice?callId=${encodeURIComponent(callId)}`;
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), fullUrl, form)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const call = await loadCall(callId);
  const reservation = call ? await loadReservation(call.reservationId) : null;
  if (!call || !reservation?.phrasePack) {
    return twimlResponse(buildTwiml({ hangup: true, actionPath: "", language: "ja-JP" }));
  }

  const greeting = phraseByCategory(reservation.phrasePack, "greeting");
  if (greeting?.audioUrl) {
    call.turns.push({
      ts: new Date().toISOString(),
      speaker: "agent",
      text: greeting.text,
      english: greeting.english,
      source: "cached",
    });
    await saveCall(call);
  }

  const language = speechLocaleFor(reservation.phrasePack.language, reservation.phoneNumber);
  return twimlResponse(
    buildTwiml({
      playUrls: greeting?.audioUrl ? [greeting.audioUrl] : [],
      actionPath: `/api/twilio/gather?callId=${encodeURIComponent(callId)}`,
      language,
    }),
  );
}
