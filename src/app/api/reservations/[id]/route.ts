import { NextResponse } from "next/server";
import { getJSON, listJSON, store } from "@/lib/store";
import { requireAdminRequest } from "@/lib/auth";
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
