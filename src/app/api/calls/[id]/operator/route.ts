// Human-in-the-loop (translation relay): the operator types English, we
// translate to the call language, synthesize, and queue it for playback on
// the live call.

import { NextRequest, NextResponse } from "next/server";
import { loadCall, saveCall, queueOperatorMessage } from "@/lib/callEngine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const call = await loadCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (call.status !== "in_progress") {
    return NextResponse.json({ error: "Call is not in progress" }, { status: 400 });
  }

  const body = await request.json();

  if (body.action === "take_over") {
    call.relayActive = true;
    await saveCall(call);
    return NextResponse.json({ call });
  }
  if (body.action === "resume_auto") {
    call.relayActive = false;
    call.unmatchedStreak = 0;
    call.pendingOperator = null;
    await saveCall(call);
    return NextResponse.json({ call });
  }

  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }
  await queueOperatorMessage(call, body.text.trim(), body.hangupAfter === true);
  const updated = await loadCall(id);
  return NextResponse.json({ call: updated });
}
