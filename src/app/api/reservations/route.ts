import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { setJSON, getJSON, listJSON } from "@/lib/store";
import { getSessionUser, requireAdminRequest } from "@/lib/auth";
import { dispatchCall } from "@/lib/dispatch";
import { ensurePhrasePacks } from "@/lib/preparePhrases";
import { isWithinCallWindow, nextCallWindowTime } from "@/lib/callWindow";
import { parsePreferences } from "@/lib/reservationInput";
import type { ReservationRequest, SavedRestaurant } from "@/lib/types";

export const runtime = "nodejs";
// Headroom for the background phrase generation that runs after the response.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    let reservations = await listJSON<ReservationRequest>("res:");
    // Admin (valid PIN + owner account) sees everything; a signed-in user
    // sees ONLY their own reservations; guests see none — a guest has no
    // identity to tie reservations to, and unowned reservations from other
    // guests must never be shown to them.
    const isAdmin = request.headers.get("x-admin-pin")
      ? (await requireAdminRequest(request)) === null
      : false;
    if (!isAdmin) {
      const user = await getSessionUser();
      reservations = user ? reservations.filter((r) => r.userId === user.id) : [];
    }
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
  if (String(body.callerName).trim().split(/\s+/).length < 2) {
    return NextResponse.json(
      { error: "Booking name must include at least first and last name, e.g. Taro Tanaka" },
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

  const user = await getSessionUser();

  let reservation: ReservationRequest = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    userId: user?.id,
    phoneNumber: body.phoneNumber,
    restaurantName: body.restaurantName,
    partySize: Number(body.partySize),
    date: body.date,
    time: body.time,
    // Optional: absent means ONLY the exact preferred time is acceptable.
    timeWindowStart: /^\d{1,2}:\d{2}$/.test(body.timeWindowStart ?? "")
      ? body.timeWindowStart
      : undefined,
    timeWindowEnd: /^\d{1,2}:\d{2}$/.test(body.timeWindowEnd ?? "")
      ? body.timeWindowEnd
      : undefined,
    language: (["en", "ja", "zh", "de", "ko", "fr"] as const).find((l) => l === body.language) ?? "ja",
    callerName: body.callerName,
    contactPhone: body.contactPhone || undefined,
    notifyEmail:
      typeof body.notifyEmail === "string" && body.notifyEmail.includes("@")
        ? body.notifyEmail.trim()
        : undefined,
    specialRequests: body.specialRequests || undefined,
    preferences: parsePreferences(body.preferences),
    status: callAt ? "scheduled" : "created",
    callAt,
  };
  await setJSON(`res:${reservation.id}`, reservation);

  // Remember this restaurant (and the details used) on the user's account so
  // a repeat booking only needs a date and time.
  if (user) {
    const restId = reservation.phoneNumber.replace(/\D/g, "");
    const restKey = `userrest:${user.id}:${restId}`;
    const prev = await getJSON<SavedRestaurant>(restKey);
    const saved: SavedRestaurant = {
      id: restId,
      name: reservation.restaurantName,
      phoneNumber: reservation.phoneNumber,
      language: reservation.language,
      partySize: reservation.partySize,
      specialRequests: reservation.specialRequests,
      preferences: reservation.preferences,
      notifyEmail: reservation.notifyEmail,
      timesBooked: (prev?.timesBooked ?? 0) + 1,
      lastBookedAt: reservation.createdAt,
    };
    await setJSON(restKey, saved);
  }

  // No schedule requested: dial right away if we're inside the destination's
  // calling window (12:00–19:00 local); otherwise queue for the next opening.
  if (!callAt) {
    if (isWithinCallWindow(new Date(), reservation.phoneNumber)) {
      const result = await dispatchCall(reservation, "agent");
      reservation = result.reservation;
    } else {
      reservation.callAt = nextCallWindowTime(new Date(), reservation.phoneNumber).toISOString();
      reservation.status = "scheduled";
      await setJSON(`res:${reservation.id}`, reservation);
    }
  }

  // Pre-script the call in the background (after the response is sent):
  // grows the persistent phrase library and readies the cached-IVR fallback.
  after(() => ensurePhrasePacks(reservation.id));

  return NextResponse.json({ reservation }, { status: 201 });
}
