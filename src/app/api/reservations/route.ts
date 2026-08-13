import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { setJSON, listJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import { ensurePhrasePacks } from "@/lib/preparePhrases";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
// Headroom for the background phrase generation that runs after the response.
export const maxDuration = 300;

export async function GET() {
  try {
    const reservations = await listJSON<ReservationRequest>("res:");
    reservations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ reservations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Create a reservation request. By default the call is placed immediately
 * (Agent mode). Pass `callAt` (ISO datetime, future) to schedule it instead.
 */
export async function POST(request: NextRequest) {
  try {
    return await handleCreate(request);
  } catch (err) {
    // Surface the real cause (bad KV credentials, storage failures, ...)
    // instead of an opaque 500.
    const message = err instanceof Error ? err.message : String(err);
    console.error("Reservation creation failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleCreate(request: NextRequest) {
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
  if (body.contactPhone && !/^\+?[\d\s-]{7,20}$/.test(body.contactPhone)) {
    return NextResponse.json(
      { error: "contactPhone must be a phone number, e.g. +6591234567" },
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
    contactPhone: body.contactPhone || undefined,
    notifyEmail:
      typeof body.notifyEmail === "string" && body.notifyEmail.includes("@")
        ? body.notifyEmail.trim()
        : undefined,
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

  // Pre-script the call in the background (after the response is sent):
  // grows the persistent phrase library and readies the cached-IVR fallback.
  after(() => ensurePhrasePacks(reservation.id));

  return NextResponse.json({ reservation }, { status: 201 });
}
