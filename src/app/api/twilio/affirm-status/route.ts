// Status callback for recorded-message affirmation calls: completed means
// the recording played (a human or their voicemail heard it); no-answer /
// busy / failed runs the staged retry policy.

import { NextRequest, NextResponse } from "next/server";
import { getJSON, setJSON } from "@/lib/store";
import { handleAffirmationNoAnswer, scheduleNextOccurrence } from "@/lib/affirm";
import { parseTwilioForm, validateTwilioSignature } from "@/lib/twilioClient";
import type { AffirmationCall } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const params = await parseTwilioForm(request);
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), request.url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }
  const affirmId = request.nextUrl.searchParams.get("affirmId") ?? "";
  const a = await getJSON<AffirmationCall>(`affirm:${affirmId}`);
  if (!a || a.status !== "calling") return NextResponse.json({ ok: true });

  const callStatus = params.CallStatus ?? "";
  if (callStatus === "completed") {
    a.status = "completed";
    a.lastActivityAt = new Date().toISOString();
    a.error = undefined;
    a.manualRetrySnapshot = undefined;
    a.summary = `Your recorded message was played to ${a.recipientName} (or their voicemail).`;
    a.summaryAt = new Date().toISOString();
    await setJSON(`affirm:${a.id}`, a);
    await scheduleNextOccurrence(a);
  } else if (["no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
    await handleAffirmationNoAnswer(a);
  }
  return NextResponse.json({ ok: true });
}
