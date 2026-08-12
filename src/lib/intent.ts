// Fast understanding of what the restaurant just said.
//
// Latency ladder (fastest first):
//   1. Keyword/substring match against the pre-generated expected utterances
//      — pure string ops, ~0ms, handles the vast majority of turns because
//      reservation calls are highly predictable.
//   2. Fast-model (Haiku) classification into the known intent list.
//   3. "unknown" — caller decides: generate a dynamic reply or escalate to
//      the human translation relay.

import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import type { ExpectedUtterance, PhrasePack } from "./types";

export interface IntentMatch {
  intent: string;
  utterance: ExpectedUtterance;
  confidence: number;
  method: "keyword" | "llm";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s、。！？!?,.]/g, "")
    .trim();
}

/** Tier 1: instant lexical matching against pre-generated expectations. */
export function matchByKeywords(transcript: string, pack: PhrasePack): IntentMatch | null {
  const t = normalize(transcript);
  if (!t) return null;

  let best: { u: ExpectedUtterance; score: number } | null = null;
  for (const u of pack.expectedUtterances) {
    let score = 0;
    for (const kw of u.keywords) {
      if (t.includes(normalize(kw))) score += 2;
    }
    for (const ex of u.examples) {
      const e = normalize(ex);
      if (!e) continue;
      if (t.includes(e) || e.includes(t)) score += 3;
    }
    if (score > 0 && (!best || score > best.score)) best = { u, score };
  }
  if (!best || best.score < 2) return null;
  return {
    intent: best.u.intent,
    utterance: best.u,
    confidence: Math.min(1, best.score / 6),
    method: "keyword",
  };
}

const ClassificationSchema = z.object({
  intent: z.string().describe("One of the provided intent names, or 'unknown'"),
  confidence: z.number().describe("0 to 1"),
});

/** Tier 2: small fast model classifies into the known intent set. */
export async function classifyWithLLM(
  transcript: string,
  pack: PhrasePack,
): Promise<IntentMatch | null> {
  const client = anthropic();
  const intentList = pack.expectedUtterances
    .map((u) => `- ${u.intent}: e.g. ${u.examples.slice(0, 2).join(" / ")}`)
    .join("\n");

  const response = await client.beta.messages.parse({
    model: config.anthropic.fastModel,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `A restaurant employee on the phone just said: "${transcript}"

Classify it as one of these intents (or "unknown" if none fit):
${intentList}`,
      },
    ],
    output_format: betaZodOutputFormat(ClassificationSchema),
  });
  assertNotRefusal(response);
  const parsed = response.parsed_output;
  if (!parsed || parsed.intent === "unknown") return null;
  const utterance = pack.expectedUtterances.find((u) => u.intent === parsed.intent);
  if (!utterance) return null;
  return { intent: parsed.intent, utterance, confidence: parsed.confidence, method: "llm" };
}

/** Full ladder: keywords, then LLM. Returns null for "unknown". */
export async function matchIntent(
  transcript: string,
  pack: PhrasePack,
): Promise<IntentMatch | null> {
  const fast = matchByKeywords(transcript, pack);
  if (fast) return fast;
  try {
    return await classifyWithLLM(transcript, pack);
  } catch (err) {
    console.error("LLM intent classification failed:", err);
    return null;
  }
}

/**
 * Tier 3 helper: generate a one-off reply for an utterance the phrase pack
 * didn't anticipate. Returns text in the call language.
 */
export async function generateDynamicReply(
  transcript: string,
  pack: PhrasePack,
  conversationSoFar: string,
): Promise<string> {
  const client = anthropic();
  const response = await client.messages.create({
    model: config.anthropic.fastModel,
    max_tokens: 300,
    system: `You are an AI agent on a live phone call making a restaurant reservation. Scenario: ${pack.scenario}. Reply with ONLY the exact words to speak next, in ${pack.language === "ja" ? "polite Japanese (keigo appropriate for a customer)" : "English"}. One or two short sentences. No commentary, no quotes.`,
    messages: [
      {
        role: "user",
        content: `Conversation so far:\n${conversationSoFar}\n\nThe restaurant just said: "${transcript}"\n\nWhat should the agent say next?`,
      },
    ],
  });
  assertNotRefusal(response);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No reply generated");
  return text.text.trim();
}
