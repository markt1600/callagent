// Place a cancellation call: the agent phones the same restaurant and
// cancels the existing booking.

import { NextResponse } from "next/server";
import { getJSON } from "@/lib/store";
import { dispatchCall } from "@/lib/dispatch";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reservation.status === "cancelled") {
    return NextResponse.json({ error: "Reservation is already cancelled" }, { status: 400 });
  }
  if (reservation.status === "calling") {
    return NextResponse.json({ error: "A call is already in progress" }, { status: 400 });
  }

  const { call } = await dispatchCall(reservation, "agent", "cancel");
  if (call.status === "failed") {
    return NextResponse.json({ error: reservation.error, call }, { status: 500 });
  }
  return NextResponse.json({ call });
}
