// IVR-mode conversation engine: decides what to say next after each
// restaurant utterance. Kept separate from the route handlers so the
// decision logic is testable.

import { getJSON, setJSON } from "./store";
import { matchIntent, matchByKeywords, generateDynamicReply } from "./intent";
import { getOrSynthesize } from "./phraseLibrary";
import { translate } from "./translate";
import { containsHan } from "./locale";
import type {
  CallSession,
  Phrase,
  PhrasePack,
  ReservationRequest,
  SupportedLanguage,
} from "./types";

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

/** Language the call is currently conducted in. */
export function activeLanguage(
  call: CallSession,
  reservation: ReservationRequest,
): SupportedLanguage {
  return call.activeLanguage ?? reservation.phrasePack?.language ?? reservation.language;
}

/** Phrase pack for the call's current language. */
export function activePack(call: CallSession, reservation: ReservationRequest): PhrasePack {
  const lang = activeLanguage(call, reservation);
  if (reservation.altPhrasePack && reservation.altPhrasePack.language === lang) {
    return reservation.altPhrasePack;
  }
  return reservation.phrasePack!;
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
  let pack = activePack(call, reservation);
  const altPack =
    reservation.altPhrasePack && reservation.altPhrasePack.language !== pack.language
      ? reservation.altPhrasePack
      : reservation.phrasePack && reservation.phrasePack.language !== pack.language
        ? reservation.phrasePack
        : null;
  const now = new Date().toISOString();

  if (transcript.trim()) {
    call.turns.push({ ts: now, speaker: "restaurant", text: transcript, confidence });
  }

  // Operator relay mode: never auto-respond, just hold for the human.
  if (call.relayActive) {
    await saveCall(call);
    return { playUrls: [], relayHold: true };
  }

  // Hard language signal: Han characters while the active pack is not
  // Chinese/Japanese means the recognizer heard Chinese — switch immediately.
  if (
    transcript.trim() &&
    altPack &&
    altPack.language === "zh" &&
    pack.language === "en" &&
    containsHan(transcript)
  ) {
    call.activeLanguage = altPack.language;
    pack = altPack;
  }

  // Empty transcript (gather timed out / silence): nudge with a clarify phrase.
  if (!transcript.trim()) {
    const clarify = phraseByCategory(pack, "clarify");
    await saveCall(call);
    return { playUrls: clarify?.audioUrl ? [clarify.audioUrl] : [] };
  }

  // --- Tier 1 + 2: match against pre-generated expectations -----------------
  let match = await matchIntent(transcript, pack);

  // If the active language doesn't fit, maybe the other side is speaking the
  // fallback language (e.g. Mandarin in Singapore) — check its pack too.
  if (!match && altPack) {
    const altMatch = matchByKeywords(transcript, altPack);
    if (altMatch) {
      call.activeLanguage = altPack.language;
      pack = altPack;
      match = altMatch;
    }
  }

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

  // Language probe: on the first miss, if a fallback-language pack exists
  // (e.g. Mandarin for Singapore), assume a language mismatch — switch the
  // recognizer + phrases to the fallback and ask "please repeat" in it. If
  // the next utterance matches the fallback pack, the call continues there.
  if (altPack && !call.languageProbed) {
    call.languageProbed = true;
    call.activeLanguage = altPack.language;
    const probe =
      phraseByCategory(altPack, "clarify") ?? phraseByCategory(altPack, "greeting");
    if (probe?.audioUrl) {
      call.turns.push({
        ts: now,
        speaker: "agent",
        text: probe.text,
        english: probe.english,
        source: "cached",
        intent: "language_probe",
      });
    }
    await saveCall(call);
    return { playUrls: probe?.audioUrl ? [probe.audioUrl] : [] };
  }

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
  const language = reservation
    ? activeLanguage(call, reservation)
    : (call.activeLanguage ?? "ja");
  const localized =
    language === "en" ? englishText : await translate(englishText, "en", language);
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
  const primary = reservation?.phrasePack?.language ?? "ja";
  const alt = reservation?.altPhrasePack?.language;

  let dirty = false;
  for (const turn of call.turns) {
    // Translate every non-English line (agent and restaurant alike) so the
    // dashboard and the emailed transcript are fully readable.
    if (turn.english || !turn.text.trim()) continue;
    // ASCII-only text is already readable English — no gloss needed.
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(turn.text)) continue;
    // Guess the turn's language: Han text on an English-primary call means
    // the fallback language (e.g. Mandarin); otherwise the primary language.
    const from: SupportedLanguage =
      primary === "en" ? (alt ?? (containsHan(turn.text) ? "zh" : "ja")) : primary;
    try {
      turn.english = await translate(turn.text, from, "en");
      dirty = true;
    } catch {
      // leave untranslated; retried next fetch
    }
  }
  if (dirty) await saveCall(call);
  return call;
}
