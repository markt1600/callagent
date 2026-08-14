import { NextResponse } from "next/server";
import { after } from "next/server";
import { getJSON, setJSON, listJSON, store } from "@/lib/store";
import { getSessionUser, requireAdminRequest } from "@/lib/auth";
import { dispatchCall } from "@/lib/dispatch";
import { ensurePhrasePacks } from "@/lib/preparePhrases";
import { isWithinCallWindow, nextCallWindowTime } from "@/lib/callWindow";
import { parsePreferences } from "@/lib/reservationInput";
import type { CallSession, ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reservation });
}

/** Edit a PENDING (scheduled) reservation. Owner only; all fields optional. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getSessionUser();
  const owned = user ? reservation.userId === user.id : !reservation.userId;
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reservation.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only pending (scheduled) reservations can be edited" },
      { status: 409 },
    );
  }

  const body = await request.json();
  if (body.phoneNumber !== undefined) {
    if (!/^\+\d{7,15}$/.test(body.phoneNumber)) {
      return NextResponse.json(
        { error: "phoneNumber must be E.164, e.g. +81312345678" },
        { status: 400 },
      );
    }
    reservation.phoneNumber = body.phoneNumber;
  }
  if (body.callerName !== undefined) {
    if (String(body.callerName).trim().split(/\s+/).length < 2) {
      return NextResponse.json(
        { error: "Booking name must include at least first and last name" },
        { status: 400 },
      );
    }
    reservation.callerName = String(body.callerName).trim();
  }
  if (body.contactPhone !== undefined) {
    const phone = String(body.contactPhone).trim();
    if (phone && !/^\+?[\d\s-]{7,20}$/.test(phone)) {
      return NextResponse.json(
        { error: "contactPhone must be a phone number, e.g. +6591234567" },
        { status: 400 },
      );
    }
    reservation.contactPhone = phone || undefined;
  }
  if (body.restaurantName !== undefined && String(body.restaurantName).trim()) {
    reservation.restaurantName = String(body.restaurantName).trim();
  }
  if (body.partySize !== undefined) {
    const n = Number(body.partySize);
    if (Number.isInteger(n) && n > 0 && n < 100) reservation.partySize = n;
  }
  if (body.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    reservation.date = body.date;
  }
  if (body.time !== undefined && /^\d{1,2}:\d{2}$/.test(body.time)) {
    reservation.time = body.time;
  }
  if (body.timeWindowStart !== undefined) {
    reservation.timeWindowStart = /^\d{1,2}:\d{2}$/.test(body.timeWindowStart ?? "")
      ? body.timeWindowStart
      : undefined;
  }
  if (body.timeWindowEnd !== undefined) {
    reservation.timeWindowEnd = /^\d{1,2}:\d{2}$/.test(body.timeWindowEnd ?? "")
      ? body.timeWindowEnd
      : undefined;
  }
  if (body.language !== undefined) {
    reservation.language =
      (["en", "ja", "zh", "de", "ko", "fr"] as const).find((l) => l === body.language) ??
      reservation.language;
  }
  if (body.notifyEmail !== undefined) {
    const email = String(body.notifyEmail).trim();
    reservation.notifyEmail = email.includes("@") ? email : undefined;
  }
  if (body.specialRequests !== undefined) {
    reservation.specialRequests = String(body.specialRequests).trim() || undefined;
  }
  if (body.preferences !== undefined) {
    reservation.preferences = parsePreferences(body.preferences);
  }

  // Details changed → the pre-scripted phrase packs are stale.
  reservation.phrasePack = undefined;
  reservation.altPhrasePack = undefined;

  // Timing: a new callAt reschedules; callNow dials immediately (window
  // permitting); otherwise the existing scheduled time is kept.
  if (body.callAt) {
    const t = new Date(body.callAt);
    if (isNaN(t.getTime())) {
      return NextResponse.json({ error: "callAt must be a valid datetime" }, { status: 400 });
    }
    reservation.callAt = t.getTime() > Date.now() + 60_000 ? t.toISOString() : new Date().toISOString();
  }
  await setJSON(`res:${id}`, reservation);

  let result = reservation;
  if (body.callNow === true) {
    if (isWithinCallWindow(new Date(), reservation.phoneNumber)) {
      result = (await dispatchCall(reservation, "agent")).reservation;
    } else {
      reservation.callAt = nextCallWindowTime(new Date(), reservation.phoneNumber).toISOString();
      await setJSON(`res:${id}`, reservation);
    }
  }

  after(() => ensurePhrasePacks(id));
  return NextResponse.json({ reservation: result });
}

/** Admin-only: delete a reservation and its call history. PIN + owner account. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const calls = await listJSON<CallSession>("call:");
  for (const call of calls) {
    if (call.reservationId === id) await store().del(`call:${call.id}`);
  }
  await store().del(`res:${id}`);
  return NextResponse.json({ ok: true });
}
