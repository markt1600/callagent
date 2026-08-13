// Agent mode: ElevenLabs Conversational AI + native Twilio integration.
//
// ElevenLabs hosts the realtime loop (streaming STT -> LLM -> streaming TTS,
// with built-in turn-taking/endpointing), which is what makes sub-second
// voice latency possible — Vercel serverless cannot hold the persistent
// media-stream WebSocket itself. Vercel remains the control plane: it
// triggers outbound calls with per-reservation dynamic variables and
// receives post-call transcript webhooks.
//
// One-time setup (ElevenLabs dashboard or API):
//   1. Create a Conversational AI agent      -> ELEVENLABS_AGENT_ID
//   2. Import your Twilio number into it      -> ELEVENLABS_AGENT_PHONE_NUMBER_ID
// The agent prompt should reference the dynamic variables passed below.

import { config, requireEnv } from "./config";
import type { ReservationRequest } from "./types";

const API = "https://api.elevenlabs.io";

function headers() {
  return {
    "xi-api-key": requireEnv(config.elevenlabs.apiKey, "ELEVENLABS_API_KEY"),
    "Content-Type": "application/json",
  };
}

/** System prompt for the ElevenLabs agent, parameterized by dynamic variables. */
export function agentPromptTemplate(): string {
  return `You are a polite, efficient assistant calling {{restaurant_name}} on behalf of {{caller_name}} to make a dinner reservation. Conduct the entire call in {{call_language}}.

Reservation to request: {{party_size}} people on {{reservation_date}} at {{reservation_time}}.
{{special_requests}}

Guidelines:
- Speak naturally and politely (in Japanese, use appropriate keigo for a customer).
- If the person answering speaks a different language than {{call_language}} (for example they answer in Mandarin), switch to their language immediately and conduct the rest of the call in it.
- State the full request early: date, time, party size.
- Answer questions about the booking name ({{caller_name}}) and callback number ({{callback_number}}).
- If the requested slot is unavailable, ask what nearby times are available that day, and accept a slot within one hour of the requested time; otherwise politely decline and end the call.
- Confirm the final reservation details back before ending the call.
- Keep responses short — this is a phone call.`;
}

export interface OutboundCallResult {
  conversationId?: string;
  callSid?: string;
  raw: unknown;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ja: "Japanese",
  en: "English",
  zh: "Mandarin Chinese",
};

/** Place an outbound call through the ElevenLabs agent via Twilio. */
export async function placeAgentCall(req: ReservationRequest): Promise<OutboundCallResult> {
  const agentId = requireEnv(config.elevenlabs.agentId, "ELEVENLABS_AGENT_ID");
  const phoneNumberId = requireEnv(
    config.elevenlabs.agentPhoneNumberId,
    "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  );

  const clientData: Record<string, unknown> = {
    dynamic_variables: {
      restaurant_name: req.restaurantName,
      caller_name: req.callerName,
      call_language: LANGUAGE_NAMES[req.language] ?? "English",
      party_size: String(req.partySize),
      reservation_date: req.date,
      reservation_time: req.time,
      special_requests: req.specialRequests
        ? `Special requests: ${req.specialRequests}`
        : "",
      callback_number: config.twilio.fromNumber,
      reservation_id: req.id,
    },
    // Force the conversation language per call. Requires the "Language"
    // override to be enabled in the agent's security/override settings.
    conversation_config_override: {
      agent: { language: req.language },
    },
  };

  const attempt = (body: Record<string, unknown>) =>
    fetch(`${API}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

  let res = await attempt({
    agent_id: agentId,
    agent_phone_number_id: phoneNumberId,
    to_number: req.phoneNumber,
    conversation_initiation_client_data: clientData,
  });

  // If the agent doesn't permit language overrides, retry without one —
  // the prompt's {{call_language}} variable still steers the language.
  if (!res.ok && res.status < 500) {
    const errText = await res.text();
    if (/override/i.test(errText)) {
      const { conversation_config_override: _dropped, ...withoutOverride } = clientData;
      res = await attempt({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: req.phoneNumber,
        conversation_initiation_client_data: withoutOverride,
      });
      if (!res.ok) {
        throw new Error(
          `ElevenLabs outbound call failed (${res.status}): ${await res.text()}`,
        );
      }
    } else {
      throw new Error(`ElevenLabs outbound call failed (${res.status}): ${errText}`);
    }
  } else if (!res.ok) {
    throw new Error(`ElevenLabs outbound call failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    conversation_id?: string;
    callSid?: string;
    call_sid?: string;
  };
  return {
    conversationId: data.conversation_id,
    callSid: data.callSid ?? data.call_sid,
    raw: data,
  };
}
