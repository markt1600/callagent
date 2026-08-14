// Upload a recorded affirmation message (WAV, produced client-side from the
// browser recording). Stored in the public audio store so Twilio <Play> can
// stream it. Returns the public URL.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { storeAudio } from "@/lib/audioStorage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // ~10 MB ≈ 5 minutes of 16 kHz mono WAV

export async function POST(request: NextRequest) {
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) {
      return NextResponse.json({ error: "Empty recording" }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: "Recording too large (max ~5 minutes)" }, { status: 413 });
    }
    // WAV sanity check: RIFF....WAVE header.
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      return NextResponse.json({ error: "Recording must be WAV audio" }, { status: 400 });
    }
    const url = await storeAudio(`affirm-rec/${randomUUID().slice(0, 12)}.wav`, bytes, "audio/wav");
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Recording upload failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
