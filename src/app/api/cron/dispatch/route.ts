// Scheduled-call dispatcher. Invoked by Vercel Cron (see vercel.json); can
// also be triggered manually. Places the call for every reservation whose
// scheduled time has arrived.
//
// When a CRON_SECRET env var is set, Vercel sends it as a Bearer token and
// we require it — prevents outsiders from triggering dials.

import { NextRequest, NextResponse } from "next/server";
import { listJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import type { ReservationRequest } from "@/lib/types";

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
    const { call } = await dispatchCall(reservation, "agent");
    dispatched.push(`${reservation.id}:${call.status}`);
  }

  return NextResponse.json({ checked: reservations.length, due: due.length, dispatched });
}
