// IVR-mode conversation engine: decides what to say next after each
// restaurant utterance. Kept separate from the route handlers so the
// decision logic is testable.

import { getJSON, setJSON } from "./store";
import { matchIntent, generateDynamicReply } from "./intent";
import { getOrSynthesize } from "./phraseLibrary";
import { translate } from "./translate";
import type { CallSession, Phrase, PhrasePack, ReservationRequest } from "./types";

export async function loadCall(callId: string): Promise<CallSession | null> {
  return getJSON<CallSession>(`call:${callId}`);
}

export async function saveCall(call: CallSession): Promise<void> {
  await setJSON(`call:${call.id}`, call);
}

export async function loadReservation(id: string): Promise<ReservationRequest | null> {
  return getJSON<ReservationRequest>(`res:${id}`);
}

export async function saveReservation(res: ReservationRequest): Promise<void> {
  await setJSON(`res:${res.id}`, res);
}

function findPhrase(pack: PhrasePack, ids: string[]): Phrase | null {
  for (const id of ids) {
    const p = pack.phrases.find((x) => x.id === id);
    if (p) return p;
  }
  return null;
}

export function phraseByCategory(pack: PhrasePack, category: Phrase["category"]): Phrase | null {
  return pack.phrases.find((p) => p.category === category) ?? null;
}

export interface NextStep {
  /** Audio URLs to play, in order */
  playUrls: string[];
  /** End the call after playing */
  hangup?: boolean;
  /** Hold and poll for the operator instead of gathering */
  relayHold?: boolean;
}

/**
 * Process one restaurant utterance and decide the agent's next move.
 * Mutates and persists the call session and (on success/failure) reservation.
 */
export async function handleRestaurantTurn(
  call: CallSession,
  reservation: ReservationRequest,
  transcript: string,
  confidence: number | undefined,
): Promise<NextStep> {
  const pack = reservation.phrasePack!;
  const now = new Date().toISOString();

  if (transcript.trim()) {
    call.turns.push({ ts: now, speaker: "restaurant", text: transcript, confidence });
  }

  // Operator relay mode: never auto-respond, just hold for the human.
  if (call.relayActive) {
    await saveCall(call);
    return { playUrls: [], relayHold: true };
  }

  // Empty transcript (gather timed out / silence): nudge with a clarify phrase.
  if (!transcript.trim()) {
    const clarify = phraseByCategory(pack, "clarify");
    await saveCall(call);
    return { playUrls: clarify?.audioUrl ? [clarify.audioUrl] : [] };
  }

  // --- Tier 1 + 2: match against pre-generated expectations -----------------
  const match = await matchIntent(transcript, pack);

  if (match) {
    call.unmatchedStreak = 0;
    const phrase = findPhrase(pack, match.utterance.responsePhraseIds);

    if (match.utterance.signalsSuccess) {
      reservation.outcome = {
        success: true,
        summary: `Reservation confirmed for ${reservation.partySize} on ${reservation.date} at ${reservation.time}.`,
        confirmedDate: reservation.date,
        confirmedTime: reservation.time,
      };
      await saveReservation(reservation);
    } else if (match.utterance.signalsFailure) {
      reservation.outcome = {
        success: false,
        summary: "Restaurant could not take the reservation.",
      };
      await saveReservation(reservation);
    }

    const playUrls: string[] = [];
    if (phrase?.audioUrl) {
      playUrls.push(phrase.audioUrl);
      call.turns.push({
        ts: now,
        speaker: "agent",
        text: phrase.text,
        english: phrase.english,
        source: "cached",
        intent: match.intent,
        confidence: match.confidence,
      });
    }

    if (match.utterance.endsCall) {
      const goodbye = phraseByCategory(pack, "goodbye");
      if (goodbye?.audioUrl && goodbye.id !== phrase?.id) playUrls.push(goodbye.audioUrl);
      await saveCall(call);
      return { playUrls, hangup: true };
    }

    await saveCall(call);
    return { playUrls };
  }

  // --- Unmatched utterance ---------------------------------------------------
  call.unmatchedStreak += 1;

  // Two misses in a row: escalate to the human translation relay.
  if (call.unmatchedStreak >= 2) {
    call.relayActive = true;
    const hold = phraseByCategory(pack, "hold");
    await saveCall(call);
    return { playUrls: hold?.audioUrl ? [hold.audioUrl] : [], relayHold: true };
  }

  // Tier 3: one-off dynamic reply (fast model + low-latency TTS, still cached
  // in the library so the same reply is instant if it ever recurs).
  try {
    const history = call.turns
      .slice(-8)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
    const replyText = await generateDynamicReply(transcript, pack, history);
    const audio = await getOrSynthesize(replyText, pack.language, "realtime");
    call.turns.push({
      ts: now,
      speaker: "agent",
      text: replyText,
      source: "generated",
    });
    await saveCall(call);
    return { playUrls: [audio.audioUrl] };
  } catch (err) {
    console.error("Dynamic reply failed, falling back to clarify:", err);
    const clarify = phraseByCategory(pack, "clarify");
    await saveCall(call);
    return { playUrls: clarify?.audioUrl ? [clarify.audioUrl] : [] };
  }
}

/** Queue an operator (human) message for playback into the live call. */
export async function queueOperatorMessage(
  call: CallSession,
  englishText: string,
  hangupAfter = false,
): Promise<void> {
  const reservation = await loadReservation(call.reservationId);
  const language = reservation?.phrasePack?.language ?? "ja";
  const localized =
    language === "en" ? englishText : await translate(englishText, "en", "ja");
  const audio = await getOrSynthesize(localized, language, "realtime");
  call.relayActive = true;
  call.pendingOperator = {
    audioUrl: audio.audioUrl,
    text: localized,
    english: englishText,
    hangupAfter,
  };
  await saveCall(call);
}

/** Translate any untranslated restaurant turns (called lazily from the dashboard). */
export async function backfillTranslations(call: CallSession): Promise<CallSession> {
  const reservation = await loadReservation(call.reservationId);
  // English-language calls need no gloss — the transcript is already readable.
  if ((reservation?.phrasePack?.language ?? "ja") === "en") return call;

  let dirty = false;
  for (const turn of call.turns) {
    if (turn.speaker === "restaurant" && !turn.english && turn.text.trim()) {
      try {
        turn.english = await translate(turn.text, "ja", "en");
        dirty = true;
      } catch {
        // leave untranslated; retried next fetch
      }
    }
  }
  if (dirty) await saveCall(call);
  return call;
}
