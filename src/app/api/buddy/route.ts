import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { dispatchBuddyCall, pickCodewords } from "@/lib/buddy";
import { listJSON, setJSON } from "@/lib/store";
import type { BuddyCall } from "@/lib/types";

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
    const at = new Date(body.callAt);
    if (isNaN(at.getTime())) {
      return NextResponse.json({ error: "Call time must be a valid datetime" }, { status: 400 });
    }

    const user = await getSessionUser();
    const buddy: BuddyCall = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      phoneNumber: body.phoneNumber,
      name: String(body.name).trim().slice(0, 60),
      callAt: at.toISOString(),
      scenario:
        typeof body.scenario === "string" && body.scenario.trim()
          ? body.scenario.trim().slice(0, 500)
          : undefined,
      ...pickCodewords(),
      status: "scheduled",
      attempts: 0,
    };
    await setJSON(`buddy:${buddy.id}`, buddy);

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
