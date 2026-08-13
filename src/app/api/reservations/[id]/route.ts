import { NextResponse } from "next/server";
import { getJSON, listJSON, store } from "@/lib/store";
import type { CallSession, ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reservation });
}

/** Admin-only: delete a reservation and its call history. Requires ADMIN_PIN. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return NextResponse.json(
      { error: "Admin is disabled — set the ADMIN_PIN environment variable" },
      { status: 501 },
    );
  }
  if (request.headers.get("x-admin-pin") !== adminPin) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

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
