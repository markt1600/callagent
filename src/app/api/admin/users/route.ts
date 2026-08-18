// Admin: every account that has signed in through Google.

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { creditsOf } from "@/lib/credits";
import { getJSON, listJSON, setJSON } from "@/lib/store";
import type { Friend, UserProfile } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const profiles = await listJSON<UserProfile>("user:");
  const users = await Promise.all(
    profiles.map(async (u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? u.bookingName ?? "",
      createdAt: u.createdAt,
      credits: creditsOf(u),
      contactPhone: u.contactPhone ?? null,
      bookingName: u.bookingName ?? "",
      buddyLanguage: u.buddyLanguage ?? "",
      friends: (await listJSON<Friend>(`userfriend:${u.id}:`)).map((f) => ({
        id: f.id,
        name: f.name,
        phoneNumber: f.phoneNumber,
        language: f.language ?? "",
      })),
    })),
  );
  users.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ users });
}

/**
 * Edit an account's details on their behalf — e.g. save the contact number
 * that links their "Me" identity to the shared per-person memory file.
 */
export async function PATCH(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const body = await request.json();
  const id = String(body.id ?? "");
  const user = await getJSON<UserProfile>(`user:${id}`);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
  if (body.bookingName !== undefined) {
    user.bookingName = String(body.bookingName).trim() || undefined;
  }
  if (body.buddyLanguage !== undefined) {
    user.buddyLanguage = (["en", "ja", "zh", "th", "vi", "de", "ko", "fr"] as const).find(
      (l) => l === body.buddyLanguage,
    );
  }
  await setJSON(`user:${id}`, user);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? user.bookingName ?? "",
      createdAt: user.createdAt,
      credits: creditsOf(user),
      contactPhone: user.contactPhone ?? null,
    },
  });
}
