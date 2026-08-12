// ElevenLabs text-to-speech synthesis (raw REST — no SDK dependency).

import { config, requireEnv } from "./config";

export interface SynthesisOptions {
  /** "prerender" = high-quality model for cached audio; "realtime" = low-latency model */
  profile?: "prerender" | "realtime";
  /** ISO 639-1 language code hint, improves pronunciation on flash/turbo models */
  languageCode?: string;
}

/** Synthesize `text` to MP3 bytes. */
export async function synthesize(text: string, opts: SynthesisOptions = {}): Promise<Buffer> {
  const apiKey = requireEnv(config.elevenlabs.apiKey, "ELEVENLABS_API_KEY");
  const voiceId = requireEnv(config.elevenlabs.voiceId, "ELEVENLABS_VOICE_ID");
  const modelId =
    opts.profile === "realtime"
      ? config.elevenlabs.realtimeModel
      : config.elevenlabs.prerenderModel;

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  };
  // language_code is only supported on flash/turbo models.
  if (opts.languageCode && /flash|turbo/.test(modelId)) {
    body.language_code = opts.languageCode;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function activeModelId(profile: "prerender" | "realtime"): string {
  return profile === "realtime"
    ? config.elevenlabs.realtimeModel
    : config.elevenlabs.prerenderModel;
}
