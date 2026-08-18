// The signed-in user's memory files: what the agents remember about each
// person (recipients keyed by phone digits, the user themself as "self").
// Viewable and erasable — memory should never be a black box.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listJSON, store } from "@/lib/store";
import type { PersonMemory } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ memories: [] });
  const memories = await listJSON<PersonMemory>(`memory:${user.id}:`);
  memories.sort((a, b) => b.lastConversationAt.localeCompare(a.lastConversationAt));
  return NextResponse.json({ memories });
}

/** Erase one memory file (?key=<digits> or ?key=self). Permanent. */
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("key") ?? "";
  const key = raw === "self" ? "self" : raw.replace(/\D/g, "");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  await store().del(`memory:${user.id}:${key}`);
  return NextResponse.json({ ok: true });
}
