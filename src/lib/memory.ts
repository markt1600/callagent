// Per-person conversational memory for the affirmation agents (calls and
// Live Chat). Instead of replaying past transcripts — which would grow the
// prompt (and latency) forever — each conversation is folded into a compact
// rolling memory file (~130 words) by the fast model AFTER the conversation
// ends, and only that file is injected next time. Bounded cost, real recall.
//
// A PERSON has one memory, not one per account: files are keyed globally by
// the person's phone digits (memory:person:{digits}), so "Lin Koh, saved as
// a friend on Mark's account" and "Me, on Lin Koh's own account" are the
// SAME file — calls placed to her and chats she starts herself all build the
// same memory. "self" resolves through the account's saved contact number;
// an account with no contact number falls back to a private per-account file
// (memory:{userId}:self). Guests have no stable identity — nothing is read
// or written for them.

import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import { getJSON, listJSON, setJSON, store } from "./store";
import type { CallTurn, PersonMemory, UserProfile } from "./types";

/**
 * The account (if any) whose saved contact number matches these phone
 * digits — how the agents learn things a person put on their own profile
 * (e.g. gender) when calling or chatting with them.
 */
export async function profileByPhone(digits: string): Promise<UserProfile | null> {
  if (!digits) return null;
  const profiles = await listJSON<UserProfile>("user:");
  return profiles.find((p) => (p.contactPhone ?? "").replace(/\D/g, "") === digits) ?? null;
}

const MAX_SUMMARY_CHARS = 1500;

/** Stable per-person key from a phone number. */
export function phonePersonKey(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

/**
 * Where a person's memory actually lives. personKey is phone digits, or
 * "self" — which follows the account's contact number so the owner's own
 * chats land in the same global file their friends' calls to them do.
 */
export async function memoryStorageKey(userId: string, personKey: string): Promise<string> {
  if (personKey !== "self") return `memory:person:${personKey}`;
  const profile = await getJSON<UserProfile>(`user:${userId}`);
  const digits = phonePersonKey(profile?.contactPhone ?? "");
  return digits ? `memory:person:${digits}` : `memory:${userId}:self`;
}

export async function loadMemory(
  userId: string,
  personKey: string,
): Promise<PersonMemory | null> {
  const key = await memoryStorageKey(userId, personKey);
  const legacyKey = `memory:${userId}:${personKey}`;
  const memory = await getJSON<PersonMemory>(key);
  if (key === legacyKey) return memory; // no shared identity — nothing to merge

  // Consolidate: earlier builds stored memory per-account. Fold any legacy
  // file into the shared one and DELETE it, so each person has exactly one
  // memory. The concatenated summary is tidied back under 130 words by the
  // rewrite after the next conversation.
  const legacy = await getJSON<PersonMemory>(legacyKey);
  if (!legacy) return memory;
  const digits = key.slice("memory:person:".length);
  const merged: PersonMemory = memory
    ? {
        summary: (memory.summary === legacy.summary
          ? memory.summary
          : `${memory.summary}\n${legacy.summary}`
        ).slice(0, MAX_SUMMARY_CHARS),
        personName: memory.personName || legacy.personName,
        personKey: digits,
        conversationCount: memory.conversationCount + legacy.conversationCount,
        lastConversationAt:
          memory.lastConversationAt > legacy.lastConversationAt
            ? memory.lastConversationAt
            : legacy.lastConversationAt,
      }
    : { ...legacy, personKey: digits };
  await setJSON(key, merged);
  await store().del(legacyKey);
  return merged;
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

    const key = await memoryStorageKey(userId, personKey);
    const memory: PersonMemory = {
      summary: block.text.trim().slice(0, MAX_SUMMARY_CHARS),
      personName,
      // The stored key is the person's global identity (their phone digits)
      // whenever one exists, never the account-relative "self".
      personKey: key.startsWith("memory:person:") ? key.slice("memory:person:".length) : personKey,
      conversationCount: (prior?.conversationCount ?? 0) + 1,
      lastConversationAt: new Date().toISOString(),
    };
    await setJSON(key, memory);
  } catch (err) {
    console.error(`Memory update failed for ${userId}:${personKey} (continuing):`, err);
  }
}
