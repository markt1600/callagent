import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { setJSON, listJSON } from "@/lib/store";
import type { ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const reservations = await listJSON<ReservationRequest>("res:");
  reservations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ reservations });
}

export async function POST(request: NextRequest) {
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

  const reservation: ReservationRequest = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    phoneNumber: body.phoneNumber,
    restaurantName: body.restaurantName,
    partySize: Number(body.partySize),
    date: body.date,
    time: body.time,
    language: body.language === "en" ? "en" : "ja",
    callerName: body.callerName,
    specialRequests: body.specialRequests || undefined,
    status: "created",
  };
  await setJSON(`res:${reservation.id}`, reservation);
  return NextResponse.json({ reservation }, { status: 201 });
}
