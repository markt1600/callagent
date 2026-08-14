import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { dispatchBuddyCall, pickCodewords, pickEmergencyCodeword } from "@/lib/buddy";
import { destinationWallClockToUtc } from "@/lib/phone";
import { listJSON, setJSON } from "@/lib/store";
import type { BuddyCall, BuddyLanguage } from "@/lib/types";

const BUDDY_LANGUAGES: BuddyLanguage[] = ["en", "ja", "zh", "th", "vi", "de", "ko", "fr"];

function parseLanguage(raw: unknown): BuddyLanguage | undefined {
  return BUDDY_LANGUAGES.includes(raw as BuddyLanguage) ? (raw as BuddyLanguage) : undefined;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await getSessionUser();
    let buddies = await listJSON<BuddyCall>("buddy:");
    buddies = buddies.filter((b) => (user ? b.userId === user.id : !b.userId));
    buddies.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ buddyCalls: buddies });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Schedule a buddy call. Contact number and time are both required. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.phoneNumber || !/^\+\d{7,15}$/.test(body.phoneNumber)) {
      return NextResponse.json(
        { error: "A contact number is required, in E.164 format — e.g. +6591234567" },
        { status: 400 },
      );
    }
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json({ error: "A name is required" }, { status: 400 });
    }
    if (!body.callAt) {
      return NextResponse.json({ error: "A call time is required" }, { status: 400 });
    }
    // A naive wall-clock time ("2026-08-14T19:30") is DESTINATION-local,
    // keyed to the number's country code (+65 → Singapore, +81 → Japan).
    // Full ISO instants (with Z/offset) are honored as-is.
    const rawAt = String(body.callAt);
    let at: Date | null = null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rawAt)) {
      at = destinationWallClockToUtc(rawAt, body.phoneNumber);
    } else {
      const parsed = new Date(rawAt);
      at = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!at) {
      return NextResponse.json({ error: "Call time must be a valid datetime" }, { status: 400 });
    }

    const user = await getSessionUser();
    // English by default; Chinese, Japanese, Thai, or Vietnamese on request.
    const language = parseLanguage(body.language) ?? "en";

    // Optional emergency contact: taken from the request, else from the
    // signed-in user's stored contact. Needs a name plus a phone or email.
    let emergencyContact: BuddyCall["emergencyContact"];
    const rawEc = body.emergencyContact as Record<string, unknown> | undefined;
    if (rawEc && typeof rawEc === "object" && String(rawEc.name ?? "").trim()) {
      const name = String(rawEc.name).trim().slice(0, 60);
      const phone =
        typeof rawEc.phone === "string" && /^\+\d{7,15}$/.test(rawEc.phone.trim())
          ? rawEc.phone.trim()
          : undefined;
      const email =
        typeof rawEc.email === "string" && rawEc.email.includes("@")
          ? rawEc.email.trim()
          : undefined;
      if (!phone && !email) {
        return NextResponse.json(
          { error: "Emergency contact needs a phone number (E.164) or an email address" },
          { status: 400 },
        );
      }
      const ecLanguage = parseLanguage(rawEc.language);
      const codeword =
        typeof rawEc.codeword === "string" && rawEc.codeword.trim()
          ? rawEc.codeword.trim().toLowerCase().slice(0, 30)
          : pickEmergencyCodeword([], ecLanguage ?? language);
      emergencyContact = { name, phone, email, codeword, language: ecLanguage };
    } else if (user?.emergencyContact) {
      emergencyContact = user.emergencyContact;
    }

    const buddy: BuddyCall = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      phoneNumber: body.phoneNumber,
      name: String(body.name).trim().slice(0, 60),
      language,
      callAt: at.toISOString(),
      scenario:
        typeof body.scenario === "string" && body.scenario.trim()
          ? body.scenario.trim().slice(0, 500)
          : undefined,
      ...pickCodewords(language, emergencyContact ? [emergencyContact.codeword] : []),
      emergencyContact,
      status: "scheduled",
      attempts: 0,
    };
    await setJSON(`buddy:${buddy.id}`, buddy);

    // Remember the language (and any emergency contact) on the account.
    if (user) {
      user.buddyLanguage = language;
      if (emergencyContact && rawEc) user.emergencyContact = emergencyContact;
      await setJSON(`user:${user.id}`, user);
    }

    // A time that's already here (or within a minute) means "call now".
    if (at.getTime() <= Date.now() + 60_000) {
      await dispatchBuddyCall(buddy);
    }

    return NextResponse.json({ buddyCall: buddy }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Buddy call creation failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
