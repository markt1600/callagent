// Twilio helpers for IVR mode: outbound dialing and TwiML generation.

import twilio from "twilio";
import type VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { config, requireEnv } from "./config";

export function twilioClient() {
  return twilio(
    requireEnv(config.twilio.accountSid, "TWILIO_ACCOUNT_SID"),
    requireEnv(config.twilio.authToken, "TWILIO_AUTH_TOKEN"),
  );
}

/** Start an outbound IVR-mode call; Twilio will fetch TwiML from our webhook. */
export async function placeIvrCall(to: string, callId: string): Promise<string> {
  const client = twilioClient();
  const call = await client.calls.create({
    to,
    from: requireEnv(config.twilio.fromNumber, "TWILIO_FROM_NUMBER"),
    url: `${config.baseUrl}/api/twilio/voice?callId=${encodeURIComponent(callId)}`,
    statusCallback: `${config.baseUrl}/api/twilio/status?callId=${encodeURIComponent(callId)}`,
    statusCallbackEvent: ["answered", "completed"],
    machineDetection: "Enable",
  });
  return call.sid;
}

export interface GatherStepOptions {
  /** Audio clips to play before listening (public URLs) */
  playUrls?: string[];
  /** Where speech results are POSTed */
  actionPath: string;
  /** Twilio speech-recognition locale, e.g. ja-JP, en-SG, en-US */
  language: string;
  /** End the call after playing (no gather) */
  hangup?: boolean;
  /** Add a pause + redirect loop instead of gathering (operator relay hold) */
  redirectPath?: string;
  redirectDelaySeconds?: number;
}

/** Build one TwiML step: play cached audio, then listen for speech. */
export function buildTwiml(opts: GatherStepOptions): string {
  const vr = new twilio.twiml.VoiceResponse();

  if (opts.hangup) {
    for (const url of opts.playUrls ?? []) vr.play(url);
    vr.hangup();
    return vr.toString();
  }

  if (opts.redirectPath) {
    for (const url of opts.playUrls ?? []) vr.play(url);
    vr.pause({ length: opts.redirectDelaySeconds ?? 3 });
    vr.redirect({ method: "POST" }, `${config.baseUrl}${opts.redirectPath}`);
    return vr.toString();
  }

  const gather = vr.gather({
    input: ["speech"],
    language: opts.language as VoiceResponse.GatherAttributes["language"],
    // "auto" ends capture quickly after the speaker stops — key latency lever.
    speechTimeout: "auto",
    speechModel: "experimental_conversations",
    action: `${config.baseUrl}${opts.actionPath}`,
    method: "POST",
    actionOnEmptyResult: true,
  });
  for (const url of opts.playUrls ?? []) gather.play(url);

  // If gather times out with no speech at all, loop back around.
  vr.redirect({ method: "POST" }, `${config.baseUrl}${opts.actionPath}`);
  return vr.toString();
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Verify an incoming webhook actually came from Twilio.
 * Skipped when no auth token is configured (local development).
 */
export function validateTwilioSignature(
  signatureHeader: string | null,
  fullUrl: string,
  formParams: Record<string, string>,
): boolean {
  if (!config.twilio.authToken) return true; // dev mode
  if (!signatureHeader) return false;
  return twilio.validateRequest(config.twilio.authToken, signatureHeader, fullUrl, formParams);
}

/** Parse a Twilio webhook form body into a plain object. */
export async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
