// Shared call-dispatch logic: used by reservation creation (call now),
// the cron route (scheduled calls), and the manual call API.

import { randomUUID } from "crypto";
import { setJSON } from "./store";
import { chargeForCall } from "./credits";
import { placeAgentCall } from "./elevenlabsAgent";
import { placeIvrCall } from "./twilioClient";
import type { CallSession, ReservationRequest } from "./types";

export interface DispatchResult {
  call: CallSession;
  reservation: ReservationRequest;
}

/**
 * Place the phone call for a reservation. Mutates and persists both the new
 * call session and the reservation. Never throws — failures are recorded on
 * the reservation so they surface in the dashboard.
 */
export async function dispatchCall(
  reservation: ReservationRequest,
  mode: "agent" | "ivr" = "agent",
  purpose: "book" | "cancel" = "book",
): Promise<DispatchResult> {
  const call: CallSession = {
    id: randomUUID().slice(0, 8),
    reservationId: reservation.id,
    mode,
    purpose,
    status: "dialing",
    startedAt: new Date().toISOString(),
    turns: [],
    relayActive: false,
    unmatchedStreak: 0,
    activeLanguage: reservation.phrasePack?.language ?? reservation.language,
    languageProbed: false,
  };

  reservation.attempts = (reservation.attempts ?? 0) + 1;

  try {
    // Account credits: every call attempt is charged before dialing.
    // Guest-mode reservations (no userId) are not charged.
    if (reservation.userId) {
      const charge = await chargeForCall(
        reservation.userId,
        reservation.phoneNumber,
        `${purpose === "cancel" ? "Cancellation" : "Reservation"} call — ${reservation.restaurantName}`,
      );
      if (!charge.ok) throw new Error(charge.error);
    }
    if (mode === "ivr") {
      if (purpose === "cancel") {
        throw new Error("Cancellation calls are Agent mode only");
      }
      if (!reservation.phrasePack) {
        throw new Error("IVR mode requires a prepared phrase pack — run prepare first");
      }
      call.twilioCallSid = await placeIvrCall(reservation.phoneNumber, call.id);
    } else {
      const result = await placeAgentCall(reservation, purpose);
      call.elevenLabsConversationId = result.conversationId;
      call.twilioCallSid = result.callSid;
    }
    call.status = "in_progress";
    reservation.status = "calling";
    reservation.error = undefined;
    // A new call means a new outcome email once it completes.
    if (purpose === "cancel") reservation.confirmationSentAt = undefined;
  } catch (err) {
    call.status = "failed";
    reservation.status = "failed";
    reservation.error = err instanceof Error ? err.message : String(err);
    console.error(`Call dispatch failed for reservation ${reservation.id}:`, err);
  }

  await setJSON(`call:${call.id}`, call);
  await setJSON(`res:${reservation.id}`, reservation);
  return { call, reservation };
}
