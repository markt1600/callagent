// Background phrase-pack preparation. Runs automatically after a reservation
// is created (no user interaction): scripts the call with Claude, pre-renders
// audio through the persistent phrase library, and attaches the packs to the
// reservation. Never touches the reservation's lifecycle status — a call may
// already be in flight.

import { getJSON, setJSON } from "./store";
import { generatePhrasePack } from "./phrasegen";
import { defaultAltLanguage } from "./locale";
import type { PhrasePack, ReservationRequest } from "./types";

export async function ensurePhrasePacks(
  reservationId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const reservation = await getJSON<ReservationRequest>(`res:${reservationId}`);
  if (!reservation) return;
  if (reservation.phrasePack && !options.force) return;

  let phrasePack: PhrasePack | undefined;
  let altPhrasePack: PhrasePack | undefined;
  const altLanguage =
    reservation.altLanguage ??
    defaultAltLanguage(reservation.language, reservation.phoneNumber);

  try {
    phrasePack = await generatePhrasePack(reservation);
    if (altLanguage && altLanguage !== reservation.language) {
      try {
        altPhrasePack = await generatePhrasePack(reservation, altLanguage);
      } catch (err) {
        console.error("Fallback-language phrase pack generation failed:", err);
      }
    }
  } catch (err) {
    console.error(`Phrase pack generation failed for reservation ${reservationId}:`, err);
    return;
  }

  // Re-load before saving — the call may have updated the reservation while
  // we were generating; only attach the packs, never clobber status/outcome.
  const fresh = await getJSON<ReservationRequest>(`res:${reservationId}`);
  if (!fresh) return;
  fresh.phrasePack = phrasePack;
  if (altPhrasePack) {
    fresh.altLanguage = altLanguage;
    fresh.altPhrasePack = altPhrasePack;
  }
  await setJSON(`res:${reservationId}`, fresh);
}
