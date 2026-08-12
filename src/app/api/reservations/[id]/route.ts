import { NextResponse } from "next/server";
import { getJSON } from "@/lib/store";
import type { ReservationRequest } from "@/lib/types";

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
