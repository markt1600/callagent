// Centralized environment configuration with sane defaults.

export const config = {
  anthropic: {
    // Deep work: phrase-pack generation, call summaries.
    smartModel: process.env.SMART_MODEL || "claude-opus-5",
    // Latency-critical work inside the live call loop: intent matching,
    // live translation, dynamic replies. Haiku keeps per-turn latency low.
    fastModel: process.env.FAST_MODEL || "claude-haiku-4-5",
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    /** Voice used for all synthesized speech. Pick a natural Japanese-capable voice. */
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
    /** High-quality model for pre-generated (cached) audio — latency irrelevant. */
    prerenderModel: process.env.ELEVENLABS_PRERENDER_MODEL || "eleven_multilingual_v2",
    /** Low-latency model for audio synthesized mid-call. */
    realtimeModel: process.env.ELEVENLABS_REALTIME_MODEL || "eleven_flash_v2_5",
    /** ElevenLabs Conversational AI agent (Agent mode) */
    agentId: process.env.ELEVENLABS_AGENT_ID || "",
    /** Phone number imported into ElevenLabs from Twilio (Agent mode) */
    agentPhoneNumberId: process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID || "",
    /** HMAC secret for post-call webhooks */
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET || "",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    fromNumber: process.env.TWILIO_FROM_NUMBER || "",
  },
  /** Public origin of this deployment, e.g. https://callagent.vercel.app */
  baseUrl:
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  blob: {
    token: process.env.BLOB_READ_WRITE_TOKEN || "",
  },
  kv: {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
  },
};

export function requireEnv(value: string, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
