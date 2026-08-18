// Admin: every account that has signed in through Google.

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { creditsOf } from "@/lib/credits";
import { listJSON } from "@/lib/store";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });

  const profiles = await listJSON<UserProfile>("user:");
  const users = profiles
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? u.bookingName ?? "",
      createdAt: u.createdAt,
      credits: creditsOf(u),
      contactPhone: u.contactPhone ?? null,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ users });
}
