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
- You placed this outbound call to the restaurant's number, so assume you have reached the right place. Restaurant staff answer in many ways — the restaurant's name, a personal name, a short hello, or just background noise. NEVER conclude it is a wrong number and never hang up because of how the call was answered; only treat it as a wrong number if the person explicitly says you have called the wrong place. If the greeting is unclear, ask once "Is this {{restaurant_name}}?" and then proceed with the reservation request.
- Speak naturally and politely (in Japanese, use appropriate keigo for a customer).
- If the person answering speaks a different language than {{call_language}} (for example they answer in Mandarin), switch to their language immediately and conduct the rest of the call in it.
- State the full request early: date, time, party size.
- The booking name is {{caller_name}}. The guest's contact number is: {{callback_number}}. If asked for a phone number, give that contact number and no other — never give the number you are calling from. If the contact number is "not available", apologize and offer the booking name instead.
- If the requested slot is unavailable, ask what times are available that day. Accept the closest available slot between {{acceptable_earliest}} and {{acceptable_latest}} without needing to check with anyone; if nothing in that range is available, politely decline and end the call.
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
      // Without an explicit range, the window collapses to the exact
      // preferred time — the agent accepts no alternatives.
      acceptable_earliest: req.timeWindowStart ?? req.time,
      acceptable_latest: req.timeWindowEnd ?? req.time,
      special_requests: req.specialRequests
        ? `Special requests: ${req.specialRequests}`
        : "",
      // The guest's own contact number — never the Twilio caller number.
      callback_number: req.contactPhone || "not available",
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
