// Speech-result webhook: the heart of the IVR-mode loop.
// Twilio POSTs the recognized speech here; we answer with the next TwiML step.

import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import {
  buildTwiml,
  twimlResponse,
  parseTwilioForm,
  validateTwilioSignature,
} from "@/lib/twilioClient";
import { loadCall, loadReservation, handleRestaurantTurn } from "@/lib/callEngine";
import { speechLocaleFor } from "@/lib/locale";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId") ?? "";
  const form = await parseTwilioForm(request);
  const fullUrl = `${config.baseUrl}/api/twilio/gather?callId=${encodeURIComponent(callId)}`;
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), fullUrl, form)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const call = await loadCall(callId);
  const reservation = call ? await loadReservation(call.reservationId) : null;
  if (!call || !reservation?.phrasePack) {
    return twimlResponse(buildTwiml({ hangup: true, actionPath: "", language: "ja-JP" }));
  }

  const transcript = form.SpeechResult ?? "";
  const confidence = form.Confidence ? Number(form.Confidence) : undefined;
  const language = speechLocaleFor(reservation.phrasePack.language, reservation.phoneNumber);
  const gatherPath = `/api/twilio/gather?callId=${encodeURIComponent(callId)}`;

  const step = await handleRestaurantTurn(call, reservation, transcript, confidence);

  if (step.hangup) {
    return twimlResponse(buildTwiml({ playUrls: step.playUrls, hangup: true, actionPath: "", language }));
  }
  if (step.relayHold) {
    return twimlResponse(
      buildTwiml({
        playUrls: step.playUrls,
        actionPath: gatherPath,
        language,
        redirectPath: `/api/twilio/relay?callId=${encodeURIComponent(callId)}`,
        redirectDelaySeconds: 3,
      }),
    );
  }
  return twimlResponse(buildTwiml({ playUrls: step.playUrls, actionPath: gatherPath, language }));
}
