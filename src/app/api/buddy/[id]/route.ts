import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getJSON, setJSON, store } from "@/lib/store";
import type { BuddyCall } from "@/lib/types";

export const runtime = "nodejs";

/** Load a buddy call only if the current session (user or guest) owns it. */
async function loadOwned(id: string): Promise<BuddyCall | null> {
  const buddy = await getJSON<BuddyCall>(`buddy:${id}`);
  if (!buddy) return null;
  const user = await getSessionUser();
  const owned = user ? buddy.userId === user.id : !buddy.userId;
  return owned ? buddy : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buddy = await loadOwned(id);
  if (!buddy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ buddyCall: buddy });
}

/** Cancel an upcoming buddy call (kept in the list for reference). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buddy = await loadOwned(id);
  if (!buddy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  buddy.status = "cancelled";
  await setJSON(`buddy:${id}`, buddy);
  return NextResponse.json({ buddyCall: buddy });
}

/** Delete a buddy call entirely. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buddy = await loadOwned(id);
  if (!buddy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await store().del(`buddy:${id}`);
  return NextResponse.json({ ok: true });
}
