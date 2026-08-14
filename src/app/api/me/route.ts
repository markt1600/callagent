import { NextRequest, NextResponse } from "next/server";
import { authConfigured, getSessionUser, googleClientId, isAdminUser } from "@/lib/auth";
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
  if (body.contactCardPrompted === true && !user.contactCardPromptedAt) {
    user.contactCardPromptedAt = new Date().toISOString();
  }
  await setJSON(`user:${user.id}`, user);
  return NextResponse.json({ user });
}
