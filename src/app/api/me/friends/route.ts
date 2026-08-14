// The signed-in user's friends list: selectable recipients for Affirmation
// Calls, with saved details (name, number, language).

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { BUDDY_LANGUAGES } from "@/lib/buddy";
import { getJSON, setJSON, listJSON, store } from "@/lib/store";
import type { BuddyLanguage, Friend } from "@/lib/types";

export const runtime = "nodejs";

function parseFriendInput(body: Record<string, unknown>): Friend | { error: string } {
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return { error: "A name is required" };
  const phone = String(body.phoneNumber ?? "").trim();
  if (!/^\+\d{7,15}$/.test(phone)) {
    return { error: "Phone number must be E.164, e.g. +6591234567" };
  }
  const language = BUDDY_LANGUAGES.includes(body.language as BuddyLanguage)
    ? (body.language as BuddyLanguage)
    : undefined;
  return { id: phone.replace(/\D/g, ""), name, phoneNumber: phone, language };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ friends: [] });
  const friends = await listJSON<Friend>(`userfriend:${user.id}:`);
  friends.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ friends });
}

/** Add a friend. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = parseFriendInput(await request.json());
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const existing = await getJSON<Friend>(`userfriend:${user.id}:${parsed.id}`);
  const friend: Friend = { ...existing, ...parsed };
  await setJSON(`userfriend:${user.id}:${friend.id}`, friend);
  return NextResponse.json({ friend }, { status: 201 });
}

/** Edit a friend (body.id targets the entry; a phone change re-keys it). */
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json();
  const id = String(body.id ?? "").replace(/\D/g, "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const existing = await getJSON<Friend>(`userfriend:${user.id}:${id}`);
  if (!existing) return NextResponse.json({ error: "Friend not found" }, { status: 404 });
  const parsed = parseFriendInput({ ...existing, ...body });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const friend: Friend = { ...existing, ...parsed };
  if (friend.id !== id) await store().del(`userfriend:${user.id}:${id}`);
  await setJSON(`userfriend:${user.id}:${friend.id}`, friend);
  return NextResponse.json({ friend });
}

/** Remove a friend (?id=<digits>). */
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id")?.replace(/\D/g, "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await store().del(`userfriend:${user.id}:${id}`);
  return NextResponse.json({ ok: true });
}
