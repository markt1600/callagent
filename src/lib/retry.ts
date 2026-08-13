// No-answer retry policy: up to 3 attempts total. Retries go 30 minutes
// later if that still lands inside today's calling window (12:00–19:00
// destination-local); otherwise the next weekday at noon. After the final
// failed attempt the reservation is marked failed and the requester is
// notified.

import { getJSON, setJSON } from "./store";
import { nextCallWindowTime } from "./callWindow";
import { sendConfirmation } from "./notify";
import type { ReservationRequest } from "./types";

export const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 30;

export async function handleNoAnswer(reservationId: string): Promise<void> {
  const reservation = await getJSON<ReservationRequest>(`res:${reservationId}`);
  if (!reservation) return;
  const attempts = reservation.attempts ?? 1;

  if (attempts >= MAX_ATTEMPTS) {
    reservation.status = "failed";
    reservation.outcome = {
      success: false,
      summary: `No answer after ${attempts} attempts — giving up.`,
    };
    reservation.callAt = undefined;
    await setJSON(`res:${reservationId}`, reservation);
    try {
      await sendConfirmation(reservationId, null);
    } catch (err) {
      console.error("Failure notification failed:", err);
    }
    return;
  }

  const next = nextCallWindowTime(new Date(), reservation.phoneNumber, RETRY_DELAY_MINUTES);
  reservation.status = "scheduled";
  reservation.callAt = next.toISOString();
  await setJSON(`res:${reservationId}`, reservation);
}
