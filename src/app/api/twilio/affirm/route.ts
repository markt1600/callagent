// TwiML for recorded-message affirmation calls: play the synthesized intro,
// the requester's own recording, then the outro, and hang up.

import { NextRequest } from "next/server";
import { getJSON } from "@/lib/store";
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
  const playUrls = [a.introUrl, a.recordingUrl, a.outroUrl].filter(
    (u): u is string => Boolean(u),
  );
  return twimlResponse(buildTwiml({ playUrls, actionPath: "", language: "en-US", hangup: true }));
}
