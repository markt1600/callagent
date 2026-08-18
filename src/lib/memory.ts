// Per-person conversational memory for the affirmation agents (calls and
// Live Chat). Instead of replaying past transcripts — which would grow the
// prompt (and latency) forever — each conversation is folded into a compact
// rolling memory file (~130 words) by the fast model AFTER the conversation
// ends, and only that file is injected next time. Bounded cost, real recall.
//
// Keys: memory:{userId}:{personKey}
//   personKey = the recipient's phone digits (affirmation calls)
//             = "self" (the account owner's own Live Chats)
// Guests have no stable identity, so no memory is read or written for them.

import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import { getJSON, setJSON } from "./store";
import type { CallTurn, PersonMemory } from "./types";

const MAX_SUMMARY_CHARS = 1500;

/** Stable per-person key from a phone number. */
export function phonePersonKey(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

export async function loadMemory(
  userId: string,
  personKey: string,
): Promise<PersonMemory | null> {
  return await getJSON<PersonMemory>(`memory:${userId}:${personKey}`);
}

/**
 * Fold a finished conversation into the person's memory file. Runs post-call
 * (webhook time), so it costs nothing during the conversation. Never throws —
 * a failed update just means the agent remembers a little less.
 */
export async function updateMemoryFromConversation(
  userId: string,
  personKey: string,
  personName: string,
  turns: CallTurn[],
): Promise<void> {
  if (!userId || !personKey || turns.length === 0) return;
  try {
    const prior = await loadMemory(userId, personKey);
    const transcript = turns
      .map((t) => `${t.speaker === "agent" ? "Agent" : personName}: ${t.text}`)
      .join("\n");

    const client = anthropic();
    const response = await client.messages.create({
      model: config.anthropic.fastModel,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `You maintain the compact memory file a friendly calling agent keeps about ${personName}.

Current memory file:
${prior?.summary ?? "(empty — this was the first conversation)"}

Transcript of the conversation that just ended:
${transcript}

Rewrite the memory file. Rules: at most 130 words; plain factual sentences; keep durable facts about ${personName} (health, family, work, plans, preferences, ongoing situations) and anything worth asking about next time; merge with the existing facts — newest information wins on conflict; drop greetings and small talk; never include the agent's own remarks or the word "agent". Output ONLY the memory file text.`,
        },
      ],
    });
    assertNotRefusal(response);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text" || !block.text.trim()) return;

    const memory: PersonMemory = {
      summary: block.text.trim().slice(0, MAX_SUMMARY_CHARS),
      personName,
      personKey,
      conversationCount: (prior?.conversationCount ?? 0) + 1,
      lastConversationAt: new Date().toISOString(),
    };
    await setJSON(`memory:${userId}:${personKey}`, memory);
  } catch (err) {
    console.error(`Memory update failed for ${userId}:${personKey} (continuing):`, err);
  }
}
