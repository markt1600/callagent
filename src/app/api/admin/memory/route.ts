// Admin: every shared per-person memory file in the system. Memory is keyed
// by the person (memory:person:{digits}), not by account, so this is the
// complete picture of what the agents remember about everyone. (Private
// per-account fallback files — accounts with no saved phone number — are
// transitional and consolidate into shared files as they're read.)

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { listJSON, store } from "@/lib/store";
import type { PersonMemory } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const memories = await listJSON<PersonMemory>("memory:person:");
  memories.sort((a, b) => b.lastConversationAt.localeCompare(a.lastConversationAt));
  return NextResponse.json({ memories });
}

/** Erase one person's memory file (?key=<digits>). Permanent, for everyone. */
export async function DELETE(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const key = (request.nextUrl.searchParams.get("key") ?? "").replace(/\D/g, "");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  await store().del(`memory:person:${key}`);
  return NextResponse.json({ ok: true });
}
