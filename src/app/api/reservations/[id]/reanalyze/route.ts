// Admin: re-run the independent outcome audit on a reservation's most
// recent transcript. Useful for correcting verdicts recorded before the
// verification step existed (or after prompt changes).

import { NextResponse } from "next/server";
import { getJSON, setJSON, listJSON } from "@/lib/store";
import { analyzeOutcome } from "@/lib/analyzeCall";
import type { CallSession, ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
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

  const calls = (await listJSON<CallSession>("call:"))
    .filter((c) => c.reservationId === id && c.turns.length > 0)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (calls.length === 0) {
    return NextResponse.json({ error: "No transcript available to analyze" }, { status: 400 });
  }

  try {
    reservation.outcome = await analyzeOutcome(reservation, calls[0].turns);
    await setJSON(`res:${id}`, reservation);
    return NextResponse.json({ reservation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
