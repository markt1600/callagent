import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { BUDDY_LANGUAGES, pickCodewords, pickEmergencyCodeword, upsertFriend } from "@/lib/buddy";
import { destinationWallClockToUtc } from "@/lib/phone";
import { getJSON, setJSON, store } from "@/lib/store";
import type { BuddyCall, BuddyLanguage } from "@/lib/types";

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

/** Edit a PENDING (scheduled) bail out call. All fields optional. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buddy = await loadOwned(id);
  if (!buddy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (buddy.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only pending (scheduled) calls can be edited" },
      { status: 409 },
    );
  }

  const body = await request.json();
  if (body.phoneNumber !== undefined) {
    if (!/^\+\d{7,15}$/.test(body.phoneNumber)) {
      return NextResponse.json(
        { error: "Phone number must be E.164, e.g. +6591234567" },
        { status: 400 },
      );
    }
    buddy.phoneNumber = body.phoneNumber;
  }
  if (body.name !== undefined && String(body.name).trim()) {
    buddy.name = String(body.name).trim().slice(0, 60);
  }
  const previousLanguage = buddy.language;
  if (body.language !== undefined && BUDDY_LANGUAGES.includes(body.language)) {
    buddy.language = body.language as BuddyLanguage;
  }
  if (body.scenario !== undefined) {
    buddy.scenario = String(body.scenario).trim().slice(0, 500) || undefined;
  }
  if (body.emergencyContact !== undefined) {
    const raw = body.emergencyContact as Record<string, unknown> | null;
    if (raw && typeof raw === "object" && String(raw.name ?? "").trim()) {
      const name = String(raw.name).trim().slice(0, 60);
      const phone =
        typeof raw.phone === "string" && /^\+\d{7,15}$/.test(raw.phone.trim())
          ? raw.phone.trim()
          : undefined;
      const email =
        typeof raw.email === "string" && raw.email.includes("@") ? raw.email.trim() : undefined;
      if (!phone && !email) {
        return NextResponse.json(
          { error: "Emergency contact needs a phone number (E.164) or an email address" },
          { status: 400 },
        );
      }
      const ecLanguage = BUDDY_LANGUAGES.includes(raw.language as BuddyLanguage)
        ? (raw.language as BuddyLanguage)
        : undefined;
      const codeword =
        typeof raw.codeword === "string" && raw.codeword.trim()
          ? raw.codeword.trim().toLowerCase().slice(0, 30)
          : (buddy.emergencyContact?.codeword ??
            pickEmergencyCodeword([buddy.codeword30, buddy.codeword60], ecLanguage ?? buddy.language));
      buddy.emergencyContact = { name, phone, email, codeword, language: ecLanguage };
      // An emergency contact also joins the friends list.
      if (buddy.userId) await upsertFriend(buddy.userId, name, phone, ecLanguage);
    } else {
      buddy.emergencyContact = undefined;
    }
  }
  // Codewords are keyed to the language — a language change re-picks them.
  if (buddy.language !== previousLanguage) {
    const picked = pickCodewords(
      buddy.language,
      buddy.emergencyContact ? [buddy.emergencyContact.codeword] : [],
    );
    buddy.codeword30 = picked.codeword30;
    buddy.codeword60 = picked.codeword60;
  }
  if (body.callAt !== undefined && body.callAt) {
    const rawAt = String(body.callAt);
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rawAt)
      ? destinationWallClockToUtc(rawAt, buddy.phoneNumber)
      : (() => {
          const d = new Date(rawAt);
          return isNaN(d.getTime()) ? null : d;
        })();
    if (!at) {
      return NextResponse.json({ error: "Call time must be a valid datetime" }, { status: 400 });
    }
    buddy.callAt = at.toISOString();
    buddy.attempts = 0;
  }
  await setJSON(`buddy:${id}`, buddy);
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
