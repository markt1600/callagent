import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { setJSON, listJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const reservations = await listJSON<ReservationRequest>("res:");
  reservations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ reservations });
}

/**
 * Create a reservation request. By default the call is placed immediately
 * (Agent mode). Pass `callAt` (ISO datetime, future) to schedule it instead.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const required = ["phoneNumber", "restaurantName", "partySize", "date", "time", "callerName"];
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `Missing field: ${field}` }, { status: 400 });
    }
  }
  if (!/^\+\d{7,15}$/.test(body.phoneNumber)) {
    return NextResponse.json(
      { error: "phoneNumber must be E.164, e.g. +81312345678" },
      { status: 400 },
    );
  }

  let callAt: string | undefined;
  if (body.callAt) {
    const t = new Date(body.callAt);
    if (isNaN(t.getTime())) {
      return NextResponse.json({ error: "callAt must be a valid datetime" }, { status: 400 });
    }
    if (t.getTime() > Date.now() + 60_000) callAt = t.toISOString();
    // A callAt in the past (or within a minute) just means "call now".
  }

  let reservation: ReservationRequest = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    phoneNumber: body.phoneNumber,
    restaurantName: body.restaurantName,
    partySize: Number(body.partySize),
    date: body.date,
    time: body.time,
    language: body.language === "en" ? "en" : body.language === "zh" ? "zh" : "ja",
    callerName: body.callerName,
    specialRequests: body.specialRequests || undefined,
    status: callAt ? "scheduled" : "created",
    callAt,
  };
  await setJSON(`res:${reservation.id}`, reservation);

  // No schedule requested: dial right away (Agent mode — no phrase prep needed).
  if (!callAt) {
    const result = await dispatchCall(reservation, "agent");
    reservation = result.reservation;
  }

  return NextResponse.json({ reservation }, { status: 201 });
}
