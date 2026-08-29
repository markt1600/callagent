// "Try again now" for a pending affirmation call: dial immediately instead
// of waiting for the scheduled (re)try. If the call connects it completes
// normally; if not, the schedule state saved here is restored by the
// no-answer handler — a failed manual attempt never consumes the retry
// budget or moves the scheduled time.

import { NextResponse } from "next/server";
import { placeAffirmationCall } from "@/lib/affirm";
import { getSessionUser } from "@/lib/auth";
import { getJSON, setJSON } from "@/lib/store";
import type { AffirmationCall } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await getJSON<AffirmationCall>(`affirm:${id}`);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getSessionUser();
  const owned = user ? call.userId === user.id : !call.userId;
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (call.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only a pending (scheduled) call can be retried now" },
      { status: 409 },
    );
  }

  call.manualRetrySnapshot = {
    callAt: call.callAt,
    attempts: call.attempts,
    attemptsInCycle: call.attemptsInCycle,
    cycle: call.cycle,
  };
  try {
    await placeAffirmationCall(call);
  } catch (err) {
    // The dial itself failed (config/API error) — restore as if untouched.
    const s = call.manualRetrySnapshot;
    call.manualRetrySnapshot = undefined;
    call.callAt = s.callAt;
    call.attempts = s.attempts;
    call.attemptsInCycle = s.attemptsInCycle;
    call.cycle = s.cycle;
    call.status = "scheduled";
    await setJSON(`affirm:${call.id}`, call);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ affirmationCall: call });
}
