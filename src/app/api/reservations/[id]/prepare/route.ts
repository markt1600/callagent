// Manually (re)generate the phrase packs for a reservation. Normally this
// isn't needed — packs are generated automatically in the background when a
// reservation is created. Kept for the Advanced/IVR flow and debugging.

import { NextResponse } from "next/server";
import { getJSON } from "@/lib/store";
import { ensurePhrasePacks } from "@/lib/preparePhrases";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await getJSON<ReservationRequest>(`res:${id}`);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await ensurePhrasePacks(id, { force: true });

  const reservation = await getJSON<ReservationRequest>(`res:${id}`);
  if (!reservation?.phrasePack) {
    return NextResponse.json(
      { error: "Phrase pack generation failed — check server logs", reservation },
      { status: 500 },
    );
  }
  return NextResponse.json({ reservation });
}
