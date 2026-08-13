// Operator-relay hold loop. While the human operator is composing a reply,
// the call parks here (short pause -> redirect). As soon as a translated
// operator message is queued, it is played and the call returns to listening.

import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import {
  buildTwiml,
  twimlResponse,
  parseTwilioForm,
  validateTwilioSignature,
} from "@/lib/twilioClient";
import { loadCall, saveCall, loadReservation } from "@/lib/callEngine";
import { speechLocaleFor } from "@/lib/locale";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId") ?? "";
  const form = await parseTwilioForm(request);
  const fullUrl = `${config.baseUrl}/api/twilio/relay?callId=${encodeURIComponent(callId)}`;
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), fullUrl, form)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const call = await loadCall(callId);
  const reservation = call ? await loadReservation(call.reservationId) : null;
  if (!call || !reservation?.phrasePack) {
    return twimlResponse(buildTwiml({ hangup: true, actionPath: "", language: "ja-JP" }));
  }

  const language = speechLocaleFor(reservation.phrasePack.language, reservation.phoneNumber);
  const relayPath = `/api/twilio/relay?callId=${encodeURIComponent(callId)}`;
  const gatherPath = `/api/twilio/gather?callId=${encodeURIComponent(callId)}`;

  const pending = call.pendingOperator;
  if (pending) {
    call.turns.push({
      ts: new Date().toISOString(),
      speaker: "operator",
      text: pending.text,
      english: pending.english,
      source: "operator_relay",
    });
    call.pendingOperator = null;
    await saveCall(call);

    if (pending.hangupAfter) {
      return twimlResponse(
        buildTwiml({ playUrls: [pending.audioUrl], hangup: true, actionPath: "", language }),
      );
    }
    // Play the operator's reply, then listen for the restaurant again.
    return twimlResponse(
      buildTwiml({ playUrls: [pending.audioUrl], actionPath: gatherPath, language }),
    );
  }

  // If the operator returned control to the automation, resume gathering.
  if (!call.relayActive) {
    return twimlResponse(buildTwiml({ playUrls: [], actionPath: gatherPath, language }));
  }

  // Nothing yet: keep holding.
  return twimlResponse(
    buildTwiml({
      playUrls: [],
      actionPath: gatherPath,
      language,
      redirectPath: relayPath,
      redirectDelaySeconds: 3,
    }),
  );
}
