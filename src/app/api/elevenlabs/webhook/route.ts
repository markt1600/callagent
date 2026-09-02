// Post-call webhook from ElevenLabs Conversational AI (Agent mode).
// Receives the full transcript + analysis after a call ends, verifies the
// HMAC signature, and stores the result against the reservation.

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { listJSON, setJSON, getJSON } from "@/lib/store";
import { sendConfirmation } from "@/lib/notify";
import { handleNoAnswer } from "@/lib/retry";
import { backfillTranslations } from "@/lib/callEngine";
import { analyzeOutcome } from "@/lib/analyzeCall";
import {
  BUDDY_MAX_ATTEMPTS,
  BUDDY_RETRY_SECONDS,
  countMentions,
  dispatchBuddyCall,
  notifyEmergencyContact,
  placeEmergencyCall,
  rescheduleBuddy,
  sendEmergencyEmail,
  transcriptMentions,
} from "@/lib/buddy";

import { handleAffirmationNoAnswer } from "@/lib/affirm";

export const maxDuration = 120;
import type { AffirmationCall, BuddyCall, CallSession, ReservationRequest } from "@/lib/types";

export const runtime = "nodejs";

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = config.elevenlabs.webhookSecret;
  if (!secret) return true; // verification disabled (dev)
  if (!header) return false;
  // Header format: t=<unix_ts>,v0=<hex hmac of "<t>.<body>">
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]),
  );
  const t = parts["t"];
  const v0 = parts["v0"];
  if (!t || !v0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return false; // stale
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v0));
  } catch {
    return false;
  }
}

interface TranscriptEntry {
  role: string;
  message?: string | null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("elevenlabs-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    type?: string;
    data?: {
      conversation_id?: string;
      transcript?: TranscriptEntry[];
      analysis?: { call_successful?: string; transcript_summary?: string };
      conversation_initiation_client_data?: {
        dynamic_variables?: Record<string, string>;
      };
    };
  };

  // No-answer / failed dial in Agent mode: mark the call and run the retry
  // policy (up to 3 attempts inside calling hours).
  if (payload.type === "call_initiation_failure" && payload.data) {
    // Buddy calls first (exact conversation match): retry every 30 seconds,
    // up to 5 tries, until the user picks up.
    const buddies = await listJSON<BuddyCall>("buddy:");

    // Emergency-relay call didn't connect: retry up to 3 times, then fall
    // back to email so the contact is never silently dropped.
    const emergencyBuddy = buddies.find(
      (b) =>
        b.emergencyConversationId && b.emergencyConversationId === payload.data!.conversation_id,
    );
    if (emergencyBuddy) {
      if ((emergencyBuddy.emergencyAttempts ?? 0) < 3) {
        await new Promise((r) => setTimeout(r, BUDDY_RETRY_SECONDS * 1000));
        try {
          await placeEmergencyCall(emergencyBuddy);
        } catch (err) {
          console.error("Emergency relay retry failed:", err);
          await sendEmergencyEmail(emergencyBuddy);
        }
      } else {
        const emailed = await sendEmergencyEmail(emergencyBuddy);
        if (!emailed) {
          emergencyBuddy.emergencyStatus = "failed";
          emergencyBuddy.error = "Emergency contact did not answer and email was unavailable";
          await setJSON(`buddy:${emergencyBuddy.id}`, emergencyBuddy);
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Affirmation call didn't connect: staged retry (+1h, +2h unless past
    // 10 PM local, next day at the original time).
    const affirmations = await listJSON<AffirmationCall>("affirm:");
    const affirmation = affirmations.find(
      (a) =>
        a.lastConversationId &&
        a.lastConversationId === payload.data!.conversation_id &&
        a.status === "calling",
    );
    if (affirmation) {
      await handleAffirmationNoAnswer(affirmation);
      return NextResponse.json({ ok: true });
    }

    const buddy = buddies.find(
      (b) => b.lastConversationId && b.lastConversationId === payload.data!.conversation_id,
    );
    if (buddy) {
      if (buddy.status !== "calling") return NextResponse.json({ ok: true });
      if (buddy.attempts >= BUDDY_MAX_ATTEMPTS) {
        buddy.status = "failed";
        buddy.error = `No answer after ${BUDDY_MAX_ATTEMPTS} attempts`;
        await setJSON(`buddy:${buddy.id}`, buddy);
      } else {
        await new Promise((r) => setTimeout(r, BUDDY_RETRY_SECONDS * 1000));
        await dispatchBuddyCall(buddy);
      }
      return NextResponse.json({ ok: true });
    }

    const calls = await listJSON<CallSession>("call:");
    const call =
      calls.find((c) => c.elevenLabsConversationId === payload.data!.conversation_id) ??
      calls
        .filter((c) => c.mode === "agent" && c.status === "in_progress")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (call) {
      call.status = "no_answer";
      call.endedAt = new Date().toISOString();
      await setJSON(`call:${call.id}`, call);
      await handleNoAnswer(call.reservationId);
    }
    return NextResponse.json({ ok: true });
  }

  if (payload.type !== "post_call_transcription" || !payload.data) {
    return NextResponse.json({ ok: true });
  }

  const data = payload.data;

  // Emergency-relay call completed: the contact answered and was informed.
  const dynVars = data.conversation_initiation_client_data?.dynamic_variables;

  // Live Chat session ended: fold it into the signed-in user's own memory
  // file (guests send no chat_user_id and are neither stored nor remembered).
  if (dynVars?.chat_user_id) {
    const turns = (data.transcript ?? [])
      .filter((t) => t.message)
      .map((t) => ({
        ts: "",
        speaker: t.role === "agent" ? ("agent" as const) : ("restaurant" as const),
        text: t.message!,
      }));
    const { updateMemoryFromConversation } = await import("@/lib/memory");
    await updateMemoryFromConversation(
      dynVars.chat_user_id,
      dynVars.chat_person_key || "self",
      dynVars.caller_name ?? "the user",
      turns,
    );
    return NextResponse.json({ ok: true });
  }
  if (dynVars?.call_mode === "emergency_relay" && dynVars.buddy_call_id) {
    const buddy = await getJSON<BuddyCall>(`buddy:${dynVars.buddy_call_id}`);
    if (buddy) {
      buddy.emergencyStatus = "notified";
      await setJSON(`buddy:${buddy.id}`, buddy);
    }
    return NextResponse.json({ ok: true });
  }

  // Affirmation call completed: store the transcript and mark delivered.
  const affirmationCallId = dynVars?.affirmation_call_id;
  if (affirmationCallId) {
    const affirmation = await getJSON<AffirmationCall>(`affirm:${affirmationCallId}`);
    if (affirmation) {
      affirmation.turns = (data.transcript ?? [])
        .filter((t) => t.message)
        .map((t) => ({
          ts: "",
          speaker: t.role === "agent" ? ("agent" as const) : ("restaurant" as const),
          text: t.message!,
        }));
      affirmation.summary = data.analysis?.transcript_summary;
      affirmation.summaryAt = new Date().toISOString();
      affirmation.status = "completed";
      // A completed conversation supersedes any earlier failure note, and a
      // manual retry that connected needs no schedule restore.
      affirmation.error = undefined;
      affirmation.manualRetrySnapshot = undefined;
      // She picked up — the consecutive-miss streak resets.
      affirmation.missedStreak = undefined;
      // The listing sorts by latest activity — a completed call rises to
      // the top even if it was scheduled long ago (or recurs).
      affirmation.lastActivityAt = new Date().toISOString();
      await setJSON(`affirm:${affirmation.id}`, affirmation);
      // Fold the conversation into the per-recipient memory file so the
      // agent remembers them next time (account-owned calls only).
      if (affirmation.userId && affirmation.turns.length > 0) {
        const { updateMemoryFromConversation, phonePersonKey } = await import("@/lib/memory");
        await updateMemoryFromConversation(
          affirmation.userId,
          phonePersonKey(affirmation.phoneNumber),
          affirmation.recipientName,
          affirmation.turns,
        );
      }
      // Recurring calls line up the next occurrence.
      const { scheduleNextOccurrence } = await import("@/lib/affirm");
      await scheduleNextOccurrence(affirmation);
    }
    return NextResponse.json({ ok: true });
  }

  // Buddy Call transcript: detect codewords in the USER's lines only (the
  // agent speaks both codewords in its briefing) and schedule the call-back.
  const buddyCallId = dynVars?.buddy_call_id;
  if (buddyCallId) {
    const buddy = await getJSON<BuddyCall>(`buddy:${buddyCallId}`);
    if (buddy) {
      buddy.turns = (data.transcript ?? [])
        .filter((t) => t.message)
        .map((t) => ({
          ts: "",
          speaker: t.role === "agent" ? ("agent" as const) : ("restaurant" as const),
          text: t.message!,
        }));
      buddy.summary = data.analysis?.transcript_summary;
      const userTurns = buddy.turns.filter((t) => t.speaker !== "agent");
      // Emergency codeword takes precedence — said AND confirmed (twice).
      if (
        buddy.emergencyContact &&
        countMentions(userTurns, buddy.emergencyContact.codeword) >= 2
      ) {
        buddy.emergencyTriggeredAt = new Date().toISOString();
        buddy.status = "completed";
        await setJSON(`buddy:${buddy.id}`, buddy);
        await notifyEmergencyContact(buddy);
      } else if (transcriptMentions(userTurns, buddy.codeword30)) {
        await rescheduleBuddy(buddy, 30);
      } else if (transcriptMentions(userTurns, buddy.codeword60)) {
        await rescheduleBuddy(buddy, 60);
      } else {
        buddy.status = "completed";
        await setJSON(`buddy:${buddy.id}`, buddy);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const reservationId =
    data.conversation_initiation_client_data?.dynamic_variables?.reservation_id;

  // Find the matching call session (by conversation id, else by reservation).
  const calls = await listJSON<CallSession>("call:");
  let call =
    calls.find((c) => c.elevenLabsConversationId === data.conversation_id) ??
    (reservationId
      ? calls.find((c) => c.reservationId === reservationId && c.mode === "agent")
      : undefined);

  if (call) {
    call.status = "completed";
    call.endedAt = new Date().toISOString();
    call.turns = (data.transcript ?? [])
      .filter((t) => t.message)
      .map((t) => ({
        ts: "",
        speaker: t.role === "agent" ? ("agent" as const) : ("restaurant" as const),
        text: t.message!,
      }));
    await setJSON(`call:${call.id}`, call);
  }

  if (reservationId) {
    const reservation = await getJSON<ReservationRequest>(`res:${reservationId}`);
    if (reservation) {
      const purpose = call?.purpose ?? "book";
      // Independent verification: Claude audits the transcript. The
      // provider's call_successful flag is only a last-resort fallback —
      // it has reported "success" on plainly failed calls.
      try {
        reservation.outcome = await analyzeOutcome(reservation, call?.turns ?? [], purpose);
      } catch (err) {
        console.error("Outcome analysis failed, falling back to provider flag:", err);
        reservation.outcome = {
          success: data.analysis?.call_successful === "success",
          summary:
            data.analysis?.transcript_summary ??
            "Call completed — see transcript for details.",
        };
      }
      reservation.status =
        purpose === "cancel" && reservation.outcome.success ? "cancelled" : "completed";
      await setJSON(`res:${reservationId}`, reservation);
    }
    // Email the requester the outcome + transcript, auto-translated to
    // English first (no-op if email isn't configured).
    try {
      const translated = call ? await backfillTranslations(call) : null;
      await sendConfirmation(reservationId, translated);
    } catch (err) {
      console.error("Confirmation send failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
