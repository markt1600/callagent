// Screening gate for recorded affirmation calls. The announcement ("this is
// a call on behalf of X — there's a personal message for Y") has played and
// we listened: ANY speech — the recipient answering, an iOS call-screening
// bot, or a voicemail greeting — advances to the message; silence repeats
// the announcement, and after 3 rounds the message plays anyway so a silent
// voicemail still captures it.

import { NextRequest } from "next/server";
import { getJSON } from "@/lib/store";
import { announceTwiml, messageSequenceTwiml } from "@/lib/affirm";
import { buildTwiml, parseTwilioForm, twimlResponse, validateTwilioSignature } from "@/lib/twilioClient";
import type { AffirmationCall } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const params = await parseTwilioForm(request);
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), request.url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }
  const affirmId = request.nextUrl.searchParams.get("affirmId") ?? "";
  const attempt = Number(request.nextUrl.searchParams.get("n") ?? "1") || 1;
  const a = await getJSON<AffirmationCall>(`affirm:${affirmId}`);
  if (!a?.recordingUrl) {
    return twimlResponse(buildTwiml({ playUrls: [], actionPath: "", language: "en-US", hangup: true }));
  }

  const heardVoice = Boolean((params.SpeechResult ?? "").trim());
  if (heardVoice || attempt >= 3) {
    return twimlResponse(messageSequenceTwiml(a));
  }
  return twimlResponse(announceTwiml(a, attempt + 1));
}
