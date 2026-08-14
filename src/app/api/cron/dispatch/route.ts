// Scheduled-call dispatcher. Invoked by Vercel Cron (see vercel.json); can
// also be triggered manually. Places the call for every reservation whose
// scheduled time has arrived.
//
// When a CRON_SECRET env var is set, Vercel sends it as a Bearer token and
// we require it — prevents outsiders from triggering dials.

import { NextRequest, NextResponse } from "next/server";
import { listJSON, setJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import { dispatchBuddyCall } from "@/lib/buddy";
import { dispatchAffirmationCall } from "@/lib/affirm";
import { isWithinCallWindow, nextCallWindowTime } from "@/lib/callWindow";
import type { AffirmationCall, BuddyCall, ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const reservations = await listJSON<ReservationRequest>("res:");
  const due = reservations.filter(
    (r) => r.status === "scheduled" && r.callAt && new Date(r.callAt).getTime() <= now,
  );

  const dispatched: string[] = [];
  for (const reservation of due) {
    // A user-scheduled time outside calling hours gets pushed to the next
    // window instead of dialing at a bad hour.
    if (!isWithinCallWindow(new Date(), reservation.phoneNumber)) {
      reservation.callAt = nextCallWindowTime(new Date(), reservation.phoneNumber).toISOString();
      await setJSON(`res:${reservation.id}`, reservation);
      dispatched.push(`${reservation.id}:deferred_to_window`);
      continue;
    }
    const { call } = await dispatchCall(reservation, "agent");
    dispatched.push(`${reservation.id}:${call.status}`);
  }

  // Buddy calls ring the user's own phone — no calling-window restriction.
  const buddies = await listJSON<BuddyCall>("buddy:");
  const dueBuddies = buddies.filter(
    (b) => b.status === "scheduled" && new Date(b.callAt).getTime() <= now,
  );
  for (const buddy of dueBuddies) {
    const result = await dispatchBuddyCall(buddy);
    dispatched.push(`buddy-${buddy.id}:${result.status}`);
  }

  // Affirmation calls: user-chosen destination-local time, no window policy.
  const affirmations = await listJSON<AffirmationCall>("affirm:");
  const dueAffirmations = affirmations.filter(
    (a) => a.status === "scheduled" && new Date(a.callAt).getTime() <= now,
  );
  for (const affirmation of dueAffirmations) {
    const result = await dispatchAffirmationCall(affirmation);
    dispatched.push(`affirm-${affirmation.id}:${result.status}`);
  }

  return NextResponse.json({
    checked: reservations.length + buddies.length + affirmations.length,
    due: due.length + dueBuddies.length + dueAffirmations.length,
    dispatched,
  });
}
