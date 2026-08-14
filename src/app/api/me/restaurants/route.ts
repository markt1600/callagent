import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getJSON, setJSON, listJSON, store } from "@/lib/store";
import type { SavedRestaurant } from "@/lib/types";

export const runtime = "nodejs";

/** Restaurants the signed-in user has booked before, most recent first. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ restaurants: [] });
  const restaurants = await listJSON<SavedRestaurant>(`userrest:${user.id}:`);
  restaurants.sort((a, b) => b.lastBookedAt.localeCompare(a.lastBookedAt));
  return NextResponse.json({ restaurants });
}

/** Edit a saved restaurant's details. Changing the phone number re-keys the entry. */
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json();
  const id = String(body.id ?? "").replace(/\D/g, "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const key = `userrest:${user.id}:${id}`;
  const saved = await getJSON<SavedRestaurant>(key);
  if (!saved) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    saved.name = name;
  }
  if (body.phoneNumber !== undefined) {
    const phone = String(body.phoneNumber).trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      return NextResponse.json(
        { error: "Phone number must be E.164, e.g. +81312345678" },
        { status: 400 },
      );
    }
    saved.phoneNumber = phone;
  }
  if (body.partySize !== undefined) {
    const n = Number(body.partySize);
    if (Number.isInteger(n) && n > 0 && n < 100) saved.partySize = n;
  }
  if (body.language === "ja" || body.language === "en" || body.language === "zh") {
    saved.language = body.language;
  }
  if (body.specialRequests !== undefined) {
    saved.specialRequests = String(body.specialRequests).trim().slice(0, 500) || undefined;
  }
  if (body.notifyEmail !== undefined) {
    const email = String(body.notifyEmail).trim();
    saved.notifyEmail = email.includes("@") ? email : undefined;
  }

  const newId = saved.phoneNumber.replace(/\D/g, "");
  if (newId !== id) {
    saved.id = newId;
    await store().del(key);
    await setJSON(`userrest:${user.id}:${newId}`, saved);
  } else {
    await setJSON(key, saved);
  }
  return NextResponse.json({ restaurant: saved });
}

/** Forget a saved restaurant (?id=<digits>). Past reservations are untouched. */
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id")?.replace(/\D/g, "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await store().del(`userrest:${user.id}:${id}`);
  return NextResponse.json({ ok: true });
}
