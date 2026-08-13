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
  return `You are a polite, efficient assistant calling {{restaurant_name}} on behalf of {{caller_name}}. Conduct the entire call in {{call_language}}.

YOUR TASK ON THIS CALL: {{task_instructions}}

Guidelines:
- You placed this outbound call to the restaurant's number, so assume you have reached the right place. Restaurant staff answer in many ways — the restaurant's name, a personal name, a short hello, or just background noise — and speech transcription frequently MISHEARS names, so a name that merely sounds similar to {{restaurant_name}} is almost certainly the same place. NEVER conclude it is a wrong number and never hang up because of how the call was answered or because a name sounds slightly different; only treat it as a wrong number if the person explicitly tells you that you have called the wrong place, and even then confirm once with "Is this {{restaurant_name}}?" before politely ending. If the greeting is unclear, ask once "Is this {{restaurant_name}}?" and then proceed with your task.
- Speak naturally and politely, and match the local conventions of the language you are speaking:
  - In JAPANESE: use appropriate keigo for a customer. This is a business call, so never open with もしもし — open with 「お世話になります」. Staff will read the booking details back to you (復唱) — let them finish without interrupting, then confirm with 「はい、お願いいたします」. Close the call with 「よろしくお願いいたします。失礼いたします」 and never hang up abruptly or while the other person is still speaking.
  - In ENGLISH (e.g. Singapore): be friendly, efficient, and direct — get to the point quickly and keep the call short. Staff commonly say "pax" for party size; use it naturally. Confirm the booking back in one concise sentence before ending, and close with a simple thank-you.
  - In MANDARIN: use polite, natural spoken 普通话 as used in Singapore. Be courteous but efficient, confirm the booking back clearly, and thank the staff before ending.
- If the person answering speaks a different language than {{call_language}} (for example they answer in Mandarin), switch to their language immediately — and to its conventions above — and conduct the rest of the call in it.
- The booking name is {{caller_name}}. The guest's contact number is: {{callback_number}}. If asked for a phone number, give that contact number and no other — never give the number you are calling from. If the contact number is "not available", apologize and offer the booking name instead.
- NEVER provide credit card numbers, deposits, or any payment details. If the restaurant requires a card or deposit to hold the booking, say the guest will contact them directly to arrange it, ask them to hold the booking if possible, and note this clearly before ending the call.
- If they say they only take bookings online or via WhatsApp, politely ask once if they can make an exception by phone; if not, thank them and end the call.
- Confirm the outcome of your task back to the staff before ending the call.
- Keep responses short — this is a phone call.`;
}

/** Per-call task brief, with all reservation specifics baked in. */
function taskInstructions(req: ReservationRequest, purpose: "book" | "cancel"): string {
  if (purpose === "cancel") {
    // Cancel the slot that was ACTUALLY booked — the restaurant may have
    // confirmed a different time than originally requested.
    const bookedDate = req.outcome?.confirmedDate ?? req.date;
    const bookedTime = req.outcome?.confirmedTime ?? req.time;
    const requestedNote =
      bookedTime !== req.time
        ? ` (the booking was originally requested for ${req.time} but was confirmed at ${bookedTime} — refer to ${bookedTime} when speaking with the staff)`
        : "";
    const apology =
      req.language === "ja"
        ? `Open with a sincere apology (「大変申し訳ないのですが…」) — cancellations are taken seriously in Japan, so be genuinely apologetic throughout, and if the staff mentions a cancellation fee (キャンセル料), acknowledge it politely and say the guest will settle it directly.`
        : `Apologize for the inconvenience, and if the staff mentions a cancellation fee, acknowledge it and say the guest will settle it directly.`;
    return `Cancel an existing reservation. ${req.callerName} has a booking at ${req.restaurantName} for ${req.partySize} people on ${bookedDate} at ${bookedTime}${requestedNote} and needs to cancel it. ${apology} Ask them to cancel the booking under the name ${req.callerName}, make sure the staff clearly confirms the reservation is cancelled, thank them sincerely, and end the call. Do NOT make any new reservation on this call.`;
  }
  const earliest = req.timeWindowStart ?? req.time;
  const latest = req.timeWindowEnd ?? req.time;
  const flexibility =
    earliest !== req.time || latest !== req.time
      ? `If that slot is unavailable, ask what times are available that day and accept the closest available slot between ${earliest} and ${latest} without needing to check with anyone; if nothing in that range is available, politely decline and end the call.`
      : `Only ${req.time} is acceptable — if that exact slot is unavailable, thank them politely and end the call without booking an alternative.`;
  return `Make a dinner reservation. State the full request early: ${req.partySize} people on ${req.date} at ${req.time}, booking name ${req.callerName}. ${flexibility}${
    req.specialRequests ? ` Also mention: ${req.specialRequests}.` : ""
  }`;
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
export async function placeAgentCall(
  req: ReservationRequest,
  purpose: "book" | "cancel" = "book",
): Promise<OutboundCallResult> {
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
      task_instructions: taskInstructions(req, purpose),
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
