import { NextRequest, NextResponse } from "next/server";
import { authConfigured, getSessionUser, googleClientId, isAdminUser } from "@/lib/auth";
import { pickEmergencyCodeword, upsertFriend } from "@/lib/buddy";
import { config } from "@/lib/config";
import { creditsOf, getCreditCosts } from "@/lib/credits";
import { setJSON } from "@/lib/store";

export const runtime = "nodejs";

/** Session + client bootstrap: who am I, is Google login available, agent number. */
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({
    user: user ? { ...user, credits: creditsOf(user) } : null,
    authConfigured: authConfigured(),
    googleClientId: authConfigured() ? googleClientId() : null,
    // The Twilio number calls come from — offered as an "Agent M" contact.
    agentNumber: config.twilio.fromNumber || null,
    // Admin UI is only offered to the owner account (PIN still required).
    isAdmin: !authConfigured() || (await isAdminUser()),
    creditCosts: await getCreditCosts(),
  });
}

/** Update the signed-in user's pre-populated details. */
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json();
  if (body.bookingName !== undefined) {
    const name = String(body.bookingName).trim();
    if (name && name.split(/\s+/).length < 2) {
      return NextResponse.json(
        { error: "Booking name must include at least first and last name" },
        { status: 400 },
      );
    }
    user.bookingName = name || undefined;
  }
  if (body.contactPhone !== undefined) {
    const phone = String(body.contactPhone).trim();
    if (phone && !/^\+?[\d\s-]{7,20}$/.test(phone)) {
      return NextResponse.json(
        { error: "Contact number must be a phone number, e.g. +6591234567" },
        { status: 400 },
      );
    }
    user.contactPhone = phone || undefined;
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
      const language = (["en", "ja", "zh", "th", "vi", "de", "ko", "fr"] as const).find(
        (l) => l === raw.language,
      );
      const codeword =
        typeof raw.codeword === "string" && raw.codeword.trim()
          ? raw.codeword.trim().toLowerCase().slice(0, 30)
          : (user.emergencyContact?.codeword ?? pickEmergencyCodeword([], language ?? "en"));
      user.emergencyContact = { name, phone, email, codeword, language };
      // An emergency contact also joins the friends list.
      await upsertFriend(user.id, name, phone, language);
    } else {
      user.emergencyContact = undefined;
    }
  }
  if (body.gender !== undefined) {
    user.gender = (["female", "male", "other"] as const).find((g) => g === body.gender);
  }
  if (body.buddyLanguage !== undefined) {
    user.buddyLanguage = (["en", "ja", "zh", "th", "vi", "de", "ko", "fr"] as const).find(
      (l) => l === body.buddyLanguage,
    );
  }
  if (body.contactCardPrompted === true && !user.contactCardPromptedAt) {
    user.contactCardPromptedAt = new Date().toISOString();
  }
  await setJSON(`user:${user.id}`, user);
  return NextResponse.json({ user });
}
