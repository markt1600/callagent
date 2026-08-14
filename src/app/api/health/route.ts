// Self-diagnosis endpoint: reports which integrations are configured and
// whether storage actually works. Values are never exposed — booleans only.

import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getJSON, setJSON, store } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const env = {
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    ELEVENLABS_API_KEY: Boolean(config.elevenlabs.apiKey),
    ELEVENLABS_VOICE_ID: Boolean(config.elevenlabs.voiceId),
    ELEVENLABS_AGENT_ID: Boolean(config.elevenlabs.agentId),
    ELEVENLABS_BUDDY_AGENT_ID: Boolean(config.elevenlabs.buddyAgentId),
    ELEVENLABS_AFFIRMATION_AGENT_ID: Boolean(config.elevenlabs.affirmationAgentId),
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: Boolean(config.elevenlabs.agentPhoneNumberId),
    ELEVENLABS_WEBHOOK_SECRET: Boolean(config.elevenlabs.webhookSecret),
    TWILIO_ACCOUNT_SID: Boolean(config.twilio.accountSid),
    TWILIO_AUTH_TOKEN: Boolean(config.twilio.authToken),
    TWILIO_FROM_NUMBER: Boolean(config.twilio.fromNumber),
    PUBLIC_BASE_URL: config.baseUrl,
    BLOB_READ_WRITE_TOKEN: Boolean(config.blob.token),
    KV_CONFIGURED: Boolean(config.kv.url && config.kv.token),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
  };

  // Live KV round-trip: this is the check that catches stale/placeholder
  // tokens, which otherwise surface as opaque 500s on every write.
  let kvStatus = "ok";
  try {
    const key = "health:ping";
    await setJSON(key, { at: new Date().toISOString() });
    await getJSON(key);
    await store().del(key);
  } catch (err) {
    kvStatus = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  const usingFileFallback = !env.KV_CONFIGURED;
  const problems: string[] = [];
  if (kvStatus !== "ok") problems.push(`KV storage broken — ${kvStatus}`);
  if (usingFileFallback && process.env.VERCEL)
    problems.push(
      "No KV configured on Vercel — data will NOT persist between requests. Connect an Upstash Redis database.",
    );
  if (!env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL)
    problems.push("No Blob token — phrase audio cannot be stored.");
  for (const k of [
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
  ] as const) {
    if (!env[k]) problems.push(`Missing ${k}`);
  }
  if (!env.ELEVENLABS_AGENT_ID || !env.ELEVENLABS_AGENT_PHONE_NUMBER_ID) {
    problems.push("Agent mode not configured (ELEVENLABS_AGENT_ID / ELEVENLABS_AGENT_PHONE_NUMBER_ID)");
  }
  if (!env.ELEVENLABS_BUDDY_AGENT_ID) {
    problems.push("Bail Out Call agent not configured (ELEVENLABS_BUDDY_AGENT_ID)");
  }
  if (!env.ELEVENLABS_AFFIRMATION_AGENT_ID) {
    problems.push(
      "Affirmation Call agent not configured (ELEVENLABS_AFFIRMATION_AGENT_ID) — typed-message affirmation calls will fail (recorded-voice ones still work)",
    );
  }

  return NextResponse.json({
    ok: problems.length === 0,
    problems,
    kv: usingFileFallback ? "file fallback (dev)" : kvStatus,
    detected: {
      kvSource: config.kv.source || "none — no KV/Redis env vars found in this deployment",
      blobSource: config.blob.source || "none — no Blob token env var found in this deployment",
    },
    env,
  });
}
