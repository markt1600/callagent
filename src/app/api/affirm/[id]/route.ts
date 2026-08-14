import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getJSON, setJSON, store } from "@/lib/store";
import type { AffirmationCall } from "@/lib/types";

export const runtime = "nodejs";

/** Load an affirmation call only if the current session (user or guest) owns it. */
async function loadOwned(id: string): Promise<AffirmationCall | null> {
  const call = await getJSON<AffirmationCall>(`affirm:${id}`);
  if (!call) return null;
  const user = await getSessionUser();
  const owned = user ? call.userId === user.id : !call.userId;
  return owned ? call : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ affirmationCall: call });
}

/** Cancel an upcoming affirmation call (kept in the list for reference). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  call.status = "cancelled";
  await setJSON(`affirm:${id}`, call);
  return NextResponse.json({ affirmationCall: call });
}

/** Delete an affirmation call entirely. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await store().del(`affirm:${id}`);
  return NextResponse.json({ ok: true });
}
