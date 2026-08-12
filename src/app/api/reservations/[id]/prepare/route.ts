// Generate the phrase pack + pre-render audio for a reservation.
// This is the slow step (Claude + TTS for any phrases not already in the
// library) so it runs as its own request with an extended time limit.

import { NextResponse } from "next/server";
import { getJSON, setJSON } from "@/lib/store";
import { generatePhrasePack } from "@/lib/phrasegen";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  reservation.status = "generating_phrases";
  await setJSON(`res:${id}`, reservation);

  try {
    reservation.phrasePack = await generatePhrasePack(reservation);
    reservation.status = "ready";
    reservation.error = undefined;
  } catch (err) {
    reservation.status = "failed";
    reservation.error = err instanceof Error ? err.message : String(err);
  }
  await setJSON(`res:${id}`, reservation);

  if (reservation.status === "failed") {
    return NextResponse.json({ error: reservation.error, reservation }, { status: 500 });
  }
  return NextResponse.json({ reservation });
}
