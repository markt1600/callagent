// Persistent, content-addressed phrase library.
//
// Every phrase the system ever synthesizes is stored once, keyed by
// sha256(language | voiceId | modelId | normalizedText), and reused on all
// future calls. Over time the library covers nearly everything a reservation
// call needs, so new reservations require little or no TTS generation.

import { createHash } from "crypto";
import { config } from "./config";
import { synthesize, activeModelId } from "./tts";
import { storeAudio } from "./audioStorage";
import { getJSON, setJSON, listJSON } from "./store";
import type { LibraryEntry, SupportedLanguage } from "./types";

const LANGUAGE_CODES: Record<SupportedLanguage, string> = {
  ja: "ja",
  en: "en",
  zh: "zh",
  de: "de",
  ko: "ko",
  fr: "fr",
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function libraryKey(text: string, language: SupportedLanguage, voiceId: string, modelId: string): string {
  return createHash("sha256")
    .update(`${language}|${voiceId}|${modelId}|${normalizeText(text)}`)
    .digest("hex")
    .slice(0, 24);
}

export interface LibraryResult {
  key: string;
  audioUrl: string;
  /** true if served from the library without new synthesis */
  cached: boolean;
}

/**
 * Return audio for `text`, synthesizing and storing it only if it has never
 * been generated before.
 */
export async function getOrSynthesize(
  text: string,
  language: SupportedLanguage,
  profile: "prerender" | "realtime" = "prerender",
): Promise<LibraryResult> {
  const voiceId = config.elevenlabs.voiceId;
  const modelId = activeModelId(profile);
  const key = libraryKey(text, language, voiceId, modelId);
  const storeKey = `lib:${key}`;

  const existing = await getJSON<LibraryEntry>(storeKey);
  if (existing) {
    existing.hits += 1;
    existing.lastUsedAt = new Date().toISOString();
    // Fire-and-forget stat update; not worth blocking the call loop on.
    void setJSON(storeKey, existing).catch(() => {});
    return { key, audioUrl: existing.audioUrl, cached: true };
  }

  const bytes = await synthesize(text, { profile, languageCode: LANGUAGE_CODES[language] });
  const audioUrl = await storeAudio(`library/${key}.mp3`, bytes);
  const entry: LibraryEntry = {
    key,
    text: normalizeText(text),
    language,
    voiceId,
    modelId,
    audioUrl,
    createdAt: new Date().toISOString(),
    hits: 1,
    lastUsedAt: new Date().toISOString(),
  };
  await setJSON(storeKey, entry);
  return { key, audioUrl, cached: false };
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const entries = await listJSON<LibraryEntry>("lib:");
  return entries.sort((a, b) => b.hits - a.hits);
}
