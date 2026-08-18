// The signed-in user's memory files: what the agents remember about each
// person. Memory is keyed by the PERSON (their phone digits, shared across
// accounts), so the view here is assembled from the user's own contact
// number ("self") plus every saved friend. Viewable and erasable — memory
// should never be a black box.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadMemory, memoryStorageKey, phonePersonKey } from "@/lib/memory";
import { listJSON, store } from "@/lib/store";
import type { Friend, PersonMemory } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ memories: [] });

  const memories: PersonMemory[] = [];
  const seen = new Set<string>();

  // The user themself — shown as "self" so the UI labels it "you", and so
  // erase targets the right file even before a contact number is saved.
  const selfDigits = phonePersonKey(user.contactPhone ?? "");
  const selfMemory = await loadMemory(user.id, "self");
  if (selfMemory) {
    memories.push({ ...selfMemory, personKey: "self" });
  }
  seen.add(selfDigits || "self");

  // Every saved friend's shared memory file.
  const friends = await listJSON<Friend>(`userfriend:${user.id}:`);
  for (const f of friends) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const memory = await loadMemory(user.id, f.id);
    if (memory) memories.push(memory);
  }

  // Legacy per-account files (pre-shared-memory) not yet migrated — e.g. a
  // call recipient who was later removed as a friend.
  const legacy = await listJSON<PersonMemory>(`memory:${user.id}:`);
  for (const m of legacy) {
    if (seen.has(m.personKey)) continue;
    seen.add(m.personKey);
    memories.push(m);
  }

  memories.sort((a, b) => b.lastConversationAt.localeCompare(a.lastConversationAt));
  return NextResponse.json({ memories });
}

/** Erase one memory file (?key=<digits> or ?key=self). Permanent — and since
 *  memory is per PERSON, erasing it clears it for every account that talks
 *  to them. */
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("key") ?? "";
  const key = raw === "self" ? "self" : raw.replace(/\D/g, "");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  const shared = await memoryStorageKey(user.id, key);
  await store().del(shared);
  await store().del(`memory:${user.id}:${key}`);
  return NextResponse.json({ ok: true });
}
