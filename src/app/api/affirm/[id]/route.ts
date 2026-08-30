import { NextResponse } from "next/server";
import { firstRandomWindowTime } from "@/lib/affirm";
import { getSessionUser } from "@/lib/auth";
import { BUDDY_LANGUAGES } from "@/lib/buddy";
import { destinationWallClockToUtc } from "@/lib/phone";
import { getJSON, setJSON, store } from "@/lib/store";
import type { AffirmationCall, BuddyLanguage } from "@/lib/types";

export const runtime = "nodejs";

/** Load an affirmation call only if the current session (user or guest) owns it. */
async function loadOwned(id: string): Promise<AffirmationCall | null> {
  const call = await getJSON<AffirmationCall>(`affirm:${id}`);
  if (!call) return null;
  const user = await getSessionUser();
  const owned = user ? call.userId === user.id : !call.userId;
  return owned ? call : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ affirmationCall: call });
}

/** Edit a PENDING (scheduled) affirmation call. All fields optional. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (call.status !== "scheduled") {
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
    call.phoneNumber = body.phoneNumber;
  }
  if (body.recipientName !== undefined && String(body.recipientName).trim()) {
    call.recipientName = String(body.recipientName).trim().slice(0, 60);
  }
  if (body.requesterName !== undefined && String(body.requesterName).trim()) {
    call.requesterName = String(body.requesterName).trim().slice(0, 60);
  }
  if (body.language !== undefined && BUDDY_LANGUAGES.includes(body.language)) {
    call.language = body.language as BuddyLanguage;
  }
  if (body.literal !== undefined) call.literal = body.literal !== false;
  if (body.persona !== undefined) {
    call.persona = body.persona === "ahbeng" ? "ahbeng" : "standard";
  }
  if (body.longChat !== undefined) call.longChat = body.longChat === true;
  if (body.checkIn !== undefined) call.checkIn = body.checkIn === true || undefined;
  if (call.persona === "ahbeng" && call.language !== "zh") call.language = "en";
  if (body.recurrence !== undefined) {
    call.recurrence = ["daily", "monthly", "annual"].includes(body.recurrence)
      ? (body.recurrence as AffirmationCall["recurrence"])
      : undefined;
  }
  if (body.randomWindowStart !== undefined || body.randomWindowEnd !== undefined) {
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const s = String(body.randomWindowStart ?? "");
    const e = String(body.randomWindowEnd ?? "");
    if (timeRe.test(s) && timeRe.test(e)) {
      if (s >= e) {
        return NextResponse.json(
          { error: "The random-time window must end after it starts" },
          { status: 400 },
        );
      }
      call.randomWindow = { start: s, end: e };
    } else {
      call.randomWindow = undefined; // cleared (or invalid → off)
    }
  }
  // A random window only makes sense on a recurring call.
  if (!call.recurrence) call.randomWindow = undefined;
  if (body.recordingUrl !== undefined) {
    if (typeof body.recordingUrl === "string" && body.recordingUrl) {
      const url = body.recordingUrl.slice(0, 500);
      const allowed =
        /^https:\/\/[^/]*\.blob\.vercel-storage\.com\//.test(url) ||
        url.startsWith(`${process.env.PUBLIC_BASE_URL ?? ""}/api/audio/`) ||
        url.startsWith("http://localhost");
      if (!allowed) {
        return NextResponse.json(
          { error: "recordingUrl must come from the /api/affirm/recording upload" },
          { status: 400 },
        );
      }
      call.recordingUrl = url;
    } else {
      call.recordingUrl = undefined;
    }
  }
  if (body.message !== undefined) {
    call.message = String(body.message).trim().slice(0, 1500);
  }
  if (!call.recordingUrl && !call.message && !call.checkIn) {
    return NextResponse.json(
      { error: "A message to deliver (or a voice recording, or check-in mode) is required" },
      { status: 400 },
    );
  }
  // Names/language changed → the synthesized intro/outro clips are stale.
  call.introUrl = undefined;
  call.outroUrl = undefined;

  if (body.callAt !== undefined && body.callAt) {
    const rawAt = String(body.callAt);
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rawAt)
      ? destinationWallClockToUtc(rawAt, call.phoneNumber)
      : (() => {
          const d = new Date(rawAt);
          return isNaN(d.getTime()) ? null : d;
        })();
    if (!at) {
      return NextResponse.json({ error: "Call time must be a valid datetime" }, { status: 400 });
    }
    // Random-window calls: the edited date matters, the time of day is drawn
    // fresh from the window (never in the past).
    const finalAt = call.randomWindow
      ? new Date(firstRandomWindowTime(at.toISOString(), call.randomWindow, call.phoneNumber))
      : at;
    call.callAt = finalAt.toISOString();
    call.originalCallAt = finalAt.toISOString();
    call.attempts = 0;
    call.attemptsInCycle = 0;
    call.cycle = 1;
  }
  await setJSON(`affirm:${id}`, call);
  return NextResponse.json({ affirmationCall: call });
}

/** Cancel an upcoming affirmation call (kept in the list for reference). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  call.status = "cancelled";
  await setJSON(`affirm:${id}`, call);
  return NextResponse.json({ affirmationCall: call });
}

/** Delete an affirmation call entirely. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = await loadOwned(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await store().del(`affirm:${id}`);
  return NextResponse.json({ ok: true });
}
