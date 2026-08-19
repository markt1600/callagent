import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { dispatchAffirmationCall, generateAffirmationMessage } from "@/lib/affirm";
import { destinationWallClockToUtc } from "@/lib/phone";
import { getJSON, listJSON, setJSON } from "@/lib/store";
import type { AffirmationCall, BuddyLanguage, Friend } from "@/lib/types";

const LANGUAGES: BuddyLanguage[] = ["en", "ja", "zh", "th", "vi", "de", "ko", "fr"];

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await getSessionUser();
    let calls = await listJSON<AffirmationCall>("affirm:");
    calls = calls.filter((a) => (user ? a.userId === user.id : !a.userId));
    // Latest ACTIVITY first: a call that just ran (even if scheduled long
    // ago, or recurring) rises to the top instead of staying buried at its
    // creation date.
    calls.sort((a, b) =>
      (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt),
    );
    return NextResponse.json({ affirmationCalls: calls });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Schedule an affirmation call. Time is destination-local (keyed to the prefix). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.phoneNumber || !/^\+\d{7,15}$/.test(body.phoneNumber)) {
      return NextResponse.json(
        { error: "A phone number is required, in E.164 format — e.g. +6591234567" },
        { status: 400 },
      );
    }
    if (!body.recipientName || !String(body.recipientName).trim()) {
      return NextResponse.json({ error: "The recipient's name is required" }, { status: 400 });
    }
    if (!body.requesterName || !String(body.requesterName).trim()) {
      return NextResponse.json({ error: "The requester's name is required" }, { status: 400 });
    }
    // Either a typed message or an uploaded voice recording is required.
    let recordingUrl: string | undefined;
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
      recordingUrl = url;
    }
    const messageKind = (["joke", "compliment", "insult"] as const).find(
      (k) => k === body.messageKind,
    );
    const checkIn = body.checkIn === true;
    if (
      !checkIn &&
      !recordingUrl &&
      !messageKind &&
      (!body.message || !String(body.message).trim())
    ) {
      return NextResponse.json(
        { error: "A message to deliver (typed, AI-generated, or recorded) — or check-in mode — is required" },
        { status: 400 },
      );
    }
    let at: Date | null = null;
    if (body.callNow === true) {
      at = new Date();
    } else {
      if (!body.callAt) {
        return NextResponse.json({ error: "A call time is required" }, { status: 400 });
      }
      const rawAt = String(body.callAt);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rawAt)) {
        at = destinationWallClockToUtc(rawAt, body.phoneNumber);
      } else {
        const parsed = new Date(rawAt);
        at = isNaN(parsed.getTime()) ? null : parsed;
      }
      if (!at) {
        return NextResponse.json({ error: "Call time must be a valid datetime" }, { status: 400 });
      }
    }

    const user = await getSessionUser();
    const call: AffirmationCall = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      phoneNumber: body.phoneNumber,
      recipientName: String(body.recipientName).trim().slice(0, 60),
      requesterName: String(body.requesterName).trim().slice(0, 60),
      message: String(body.message ?? "").trim().slice(0, 1500),
      literal: body.literal !== false,
      recordingUrl,
      language: LANGUAGES.includes(body.language) ? (body.language as BuddyLanguage) : "en",
      persona: body.persona === "ahbeng" ? "ahbeng" : "standard",
      longChat: body.longChat === true,
      checkIn: checkIn || undefined,
      recurrence: ["daily", "monthly", "annual"].includes(body.recurrence)
        ? (body.recurrence as AffirmationCall["recurrence"])
        : undefined,
      callAt: at.toISOString(),
      originalCallAt: at.toISOString(),
      status: "scheduled",
      attempts: 0,
      attemptsInCycle: 0,
      cycle: 1,
    };
    // Ah Beng only speaks English and Chinese.
    if (call.persona === "ahbeng" && call.language !== "zh") call.language = "en";

    // AI-generated message: written now (in the call's language) so the user
    // can see exactly what will be delivered on the card.
    if (messageKind && !checkIn && !recordingUrl && !call.message) {
      call.messageKind = messageKind;
      call.message = await generateAffirmationMessage(
        messageKind,
        call.language,
        call.recipientName,
        call.requesterName,
      );
    }
    await setJSON(`affirm:${call.id}`, call);

    // Remember the recipient as a friend on the account (keyed by number).
    if (user) {
      const fid = call.phoneNumber.replace(/\D/g, "");
      const fkey = `userfriend:${user.id}:${fid}`;
      const prev = await getJSON<Friend>(fkey);
      const friend: Friend = {
        id: fid,
        name: call.recipientName,
        phoneNumber: call.phoneNumber,
        language: call.language,
        timesCalled: (prev?.timesCalled ?? 0) + 1,
        lastCalledAt: call.createdAt,
      };
      await setJSON(fkey, friend);
    }

    // A time that's already here (or within a minute) means "call now".
    if (at.getTime() <= Date.now() + 60_000) {
      await dispatchAffirmationCall(call);
    }

    return NextResponse.json({ affirmationCall: call }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Affirmation call creation failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
