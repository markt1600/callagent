// Replay loop for recorded-message affirmation calls: after each playback
// the callee is asked whether they'd like to hear it again. Yes → replay
// and ask again; no / silence / anything else → warm outro and hang up.

import { NextRequest } from "next/server";
import { getJSON } from "@/lib/store";
import { affirmSpeechLocale, wantsReplay } from "@/lib/affirm";
import { buildTwiml, parseTwilioForm, twimlResponse, validateTwilioSignature } from "@/lib/twilioClient";
import type { AffirmationCall } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const params = await parseTwilioForm(request);
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), request.url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }
  const affirmId = request.nextUrl.searchParams.get("affirmId") ?? "";
  const a = await getJSON<AffirmationCall>(`affirm:${affirmId}`);
  if (!a?.recordingUrl) {
    return twimlResponse(buildTwiml({ playUrls: [], actionPath: "", language: "en-US", hangup: true }));
  }

  const speech = params.SpeechResult ?? "";
  if (wantsReplay(speech, a.language) && a.replayPromptUrl) {
    // Hear it again, then ask again — loops until a no or a hang-up.
    return twimlResponse(
      buildTwiml({
        playUrls: [a.recordingUrl, a.replayPromptUrl],
        actionPath: `/api/twilio/affirm-replay?affirmId=${encodeURIComponent(a.id)}`,
        language: affirmSpeechLocale(a.language),
      }),
    );
  }

  return twimlResponse(
    buildTwiml({
      playUrls: a.outroUrl ? [a.outroUrl] : [],
      actionPath: "",
      language: "en-US",
      hangup: true,
    }),
  );
}
