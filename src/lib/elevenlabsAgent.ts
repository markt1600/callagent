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

/** Place an outbound call through the ElevenLabs agent via Twilio. */
export async function placeAgentCall(req: ReservationRequest): Promise<OutboundCallResult> {
  const agentId = requireEnv(config.elevenlabs.agentId, "ELEVENLABS_AGENT_ID");
  const phoneNumberId = requireEnv(
    config.elevenlabs.agentPhoneNumberId,
    "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  );

  const languageName = req.language === "ja" ? "Japanese" : "English";
  const res = await fetch(`${API}/v1/convai/twilio/outbound-call`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: req.phoneNumber,
      conversation_initiation_client_data: {
        dynamic_variables: {
          restaurant_name: req.restaurantName,
          caller_name: req.callerName,
          call_language: languageName,
          party_size: String(req.partySize),
          reservation_date: req.date,
          reservation_time: req.time,
          special_requests: req.specialRequests
            ? `Special requests: ${req.specialRequests}`
            : "",
          callback_number: config.twilio.fromNumber,
          reservation_id: req.id,
        },
        // Force the conversation language per call (agent must list it as enabled).
        conversation_config_override: {
          agent: { language: req.language },
        },
      },
    }),
  });

  if (!res.ok) {
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
