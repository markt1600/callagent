// AI phrase-pack generation.
//
// When a reservation request is created we ask Claude to script the whole
// call in advance: everything we might need to say, and everything the
// restaurant is likely to say back. Each of our phrases is then synthesized
// through the persistent phrase library (cache-first), so by call time the
// audio is already sitting in storage and playback is instant.

import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import { getOrSynthesize } from "./phraseLibrary";
import type { ExpectedUtterance, Phrase, PhrasePack, ReservationRequest } from "./types";

const PhraseSchema = z.object({
  id: z.string().describe("Short snake_case identifier, e.g. greeting_1"),
  text: z.string().describe("The phrase in the call language, natural spoken register"),
  english: z.string().describe("English translation"),
  category: z.enum([
    "greeting",
    "request",
    "confirm",
    "deny",
    "clarify",
    "answer_party_size",
    "answer_date_time",
    "answer_name",
    "answer_contact",
    "special_request",
    "hold",
    "fallback",
    "thanks",
    "goodbye",
  ]),
});

const ExpectedUtteranceSchema = z.object({
  intent: z.string().describe("snake_case intent name, e.g. ask_party_size"),
  examples: z
    .array(z.string())
    .describe("3-6 example phrasings the restaurant might use, in the call language"),
  keywords: z
    .array(z.string())
    .describe("Distinctive keywords/substrings that signal this intent (call language)"),
  responsePhraseIds: z
    .array(z.string())
    .describe("Phrase ids that answer this, in preference order"),
  signalsSuccess: z.boolean().describe("True if this means the reservation was accepted"),
  signalsFailure: z.boolean().describe("True if this means the reservation was declined"),
  endsCall: z.boolean().describe("True if the call should end after our response"),
});

const PhrasePackSchema = z.object({
  scenario: z.string().describe("One-line description of the call scenario"),
  phrases: z.array(PhraseSchema),
  expectedUtterances: z.array(ExpectedUtteranceSchema),
});

function buildPrompt(req: ReservationRequest): string {
  const isJa = req.language === "ja";
  const langName = isJa ? "Japanese" : "English";
  const styleGuide = isJa
    ? `use appropriate keigo for a customer calling a restaurant; write numbers, dates and times the way they are SPOKEN, e.g. 「8月20日水曜日、19時に2名」`
    : `use polite, natural spoken English suitable for an international phone call (the restaurant staff may not be native English speakers — keep sentences short and unambiguous); write numbers, dates and times the way they are SPOKEN, e.g. "a table for two on Wednesday, August the twentieth, at seven pm"`;
  const repeatExample = isJa
    ? `("すみません、もう一度お願いします")`
    : `("Sorry, could you say that again, please?")`;
  const holdExample = isJa ? `("少々お待ちください")` : `("One moment, please.")`;
  const utteranceExample = isJa
    ? `(e.g. ask_party_size → 「何名様」「何名様でしょうか」, keywords 「何名」「人数」)`
    : `(e.g. ask_party_size → "For how many people?" / "How many in your party?", keywords "how many", "people", "pax")`;

  return `You are preparing a phone script for an AI agent that will call a restaurant and make a dinner reservation. The call will be conducted in ${langName}.

Reservation details:
- Restaurant: ${req.restaurantName}
- Party size: ${req.partySize}
- Date: ${req.date}
- Time: ${req.time}
- Booking name: ${req.callerName}
${req.specialRequests ? `- Special requests: ${req.specialRequests}` : ""}

Produce a complete phrase pack:

1. "phrases": every line the agent may need to say, in natural polite ${langName} (${styleGuide}). Cover at minimum: a greeting that states the purpose and the full reservation request in one sentence; answers for party size, date/time, name (include a spelled-out reading if the name could be misheard), and contact/phone-number follow-ups; a confirmation ("yes that's right"); a polite correction/denial; asking the other side to repeat ${repeatExample}; a short hold phrase ${holdExample}; handling "we're full" (ask about nearby times as a fallback, then thank and end); thanks; and a polite goodbye. Keep every phrase self-contained — it will be played as a standalone audio clip.

2. "expectedUtterances": everything the restaurant is likely to say in ${langName}, as intents with example phrasings and distinctive keywords ${utteranceExample}. Map each intent to the phrase ids that answer it. Include intents for: the restaurant answering the phone, asking party size / date / time / name / phone number, saying the slot is available, confirming the booking back (signalsSuccess), saying they are full (signalsFailure), asking the agent to wait, asking the agent to repeat, and closing the call (endsCall).

Phrases used by common intents (greetings, confirmations, "please repeat", hold, thanks, goodbye) should use the most standard, conventional wording — identical wording across different reservations lets the system reuse cached audio.`;
}

/** Generate a phrase pack with Claude and pre-render all audio through the library. */
export async function generatePhrasePack(req: ReservationRequest): Promise<PhrasePack> {
  const client = anthropic();

  const response = await client.beta.messages.parse({
    model: config.anthropic.smartModel,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildPrompt(req) }],
    output_format: betaZodOutputFormat(PhrasePackSchema),
  });
  assertNotRefusal(response);
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Phrase pack generation returned no parseable output");

  // Pre-render all audio, cache-first via the persistent library.
  let libraryHits = 0;
  let newlySynthesized = 0;
  const phrases: Phrase[] = [];
  for (const p of parsed.phrases) {
    try {
      const result = await getOrSynthesize(p.text, req.language, "prerender");
      if (result.cached) libraryHits += 1;
      else newlySynthesized += 1;
      phrases.push({ ...p, audioUrl: result.audioUrl, libraryKey: result.key });
    } catch (err) {
      // A single failed synthesis shouldn't sink the pack; the IVR loop can
      // fall back to realtime TTS for phrases without audio.
      console.error(`TTS failed for phrase ${p.id}:`, err);
      phrases.push({ ...p });
    }
  }

  const expectedUtterances: ExpectedUtterance[] = parsed.expectedUtterances;

  return {
    language: req.language,
    scenario: parsed.scenario,
    phrases,
    expectedUtterances,
    generatedAt: new Date().toISOString(),
    cacheStats: { libraryHits, newlySynthesized },
  };
}
