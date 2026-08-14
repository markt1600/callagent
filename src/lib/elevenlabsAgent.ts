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
import { contactNumberForCall } from "./phone";
import type { ReservationPreferences, ReservationRequest } from "./types";

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
  }${preferenceBrief(req.preferences)}`;
}

/** Turn stored preferences into proactive + only-if-asked instructions. */
export function preferenceBrief(p?: ReservationPreferences): string {
  if (!p) return "";
  const proactive: string[] = [];
  const reactive: string[] = [];

  // Proactive — the agent raises these itself.
  if (p.privateRoom) {
    proactive.push(
      "a PRIVATE ROOM is required — request one explicitly; if no private room is available, do not book and politely end the call",
    );
  } else if (p.quietTable) {
    proactive.push(
      "ask for a quieter table with more privacy if possible (a preference, not a requirement — book either way)",
    );
  }
  if (p.kidsCount && p.kidsCount > 0) {
    proactive.push(
      `the party includes ${p.kidsCount} ${p.kidsCount === 1 ? "child" : "children"} — mention this when booking${
        p.kidsSeating ? ", and request children's seats / high chairs" : ""
      }`,
    );
  }
  if (p.occasion) {
    const occasionNames = {
      birthday: "a birthday",
      anniversary: "an anniversary",
      business: "a business dinner",
      date: "a special date night",
    } as const;
    const whose = p.occasionName?.trim() ? ` for ${p.occasionName.trim()}` : "";
    proactive.push(
      `mention that the booking is a special occasion — ${occasionNames[p.occasion]}${whose}`,
    );
    if (p.occasion === "birthday" && p.birthdayCake) {
      proactive.push(
        `ask whether the restaurant can prepare a birthday cake${
          p.occasionName?.trim() ? ` for ${p.occasionName.trim()}` : ""
        } — make clear the guest is happy to pay an extra charge for it, and that it is completely fine if a cake is not available (proceed with the booking either way)`,
      );
    }
  }
  if (p.allergies?.trim()) {
    proactive.push(
      `IMPORTANT — inform the restaurant about allergies/dietary restrictions: ${p.allergies.trim()}. Always state this before ending the call, and ask them to note it on the booking`,
    );
  }
  if (p.accessibility) {
    proactive.push("mention that wheelchair/stroller access is needed and confirm they can accommodate it");
  }
  if (p.askCorkage) {
    proactive.push(
      "ask about their corkage policy — whether guests may bring their own wine and what the corkage fee is per bottle. This is an inquiry only: note their answer carefully so it can be reported back, and complete the booking regardless of the policy",
    );
  }

  // Reactive — answered only if the restaurant brings the topic up.
  if (p.seating) {
    const seatingNames = { indoor: "indoor seating", outdoor: "outdoor seating", counter: "counter seating" };
    reactive.push(`seating: the guest prefers ${seatingNames[p.seating]}`);
  }
  if (p.minimumSpendOk !== undefined) {
    reactive.push(
      p.minimumSpendOk
        ? "minimum spend: if they mention one, the guest accepts it"
        : "minimum spend: if they mention one, the guest does NOT accept it — politely decline the booking",
    );
  }
  if (p.smoking) {
    reactive.push(
      `smoking section: if asked, the guest wants ${p.smoking === "non_smoking" ? "non-smoking" : "smoking"}`,
    );
  }
  if (p.timeLimitOk !== undefined) {
    reactive.push(
      p.timeLimitOk
        ? "seating time limit: if they mention one, the guest accepts it"
        : "seating time limit: if they mention one, the guest does NOT accept it — politely decline the booking",
    );
  }

  let out = "";
  if (proactive.length) out += ` During the call, also: ${proactive.join("; ")}.`;
  if (reactive.length) {
    out += ` The following are ONLY-IF-ASKED preferences — do not bring them up yourself, but use them if the restaurant raises the topic: ${reactive.join("; ")}.`;
  }
  return out;
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
  de: "German",
  ko: "Korean",
  fr: "French",
};

// Spoken the instant the call connects (the agent's First message in the
// ElevenLabs dashboard is set to {{first_message}}, so this is fully
// app-controlled per language AND per task — no dead air, no LLM latency,
// and no generic wording compromise between booking and cancelling.
const FIRST_MESSAGES: Record<string, Record<"book" | "cancel", string>> = {
  ja: {
    book: "お世話になります。予約をお願いしたく、お電話いたしました。",
    cancel: "お世話になります。予約のキャンセルの件でお電話いたしました。",
  },
  en: {
    book: "Hello! I'm calling to make a dinner reservation.",
    cancel: "Hello! I'm calling about cancelling an existing reservation.",
  },
  zh: {
    book: "你好，我想订个位子，麻烦您了。",
    cancel: "你好，我想取消一个订位，麻烦您了。",
  },
  de: {
    book: "Guten Tag! Ich rufe an, um einen Tisch zu reservieren.",
    cancel: "Guten Tag! Ich rufe wegen der Stornierung einer bestehenden Reservierung an.",
  },
  ko: {
    book: "안녕하세요, 예약을 하고 싶어서 전화드렸습니다.",
    cancel: "안녕하세요, 기존 예약 취소 건으로 전화드렸습니다.",
  },
  fr: {
    book: "Bonjour ! Je vous appelle pour réserver une table.",
    cancel: "Bonjour ! Je vous appelle au sujet de l'annulation d'une réservation.",
  },
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
      first_message: (FIRST_MESSAGES[req.language] ?? FIRST_MESSAGES.en)[purpose],
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
      // Domestic format when calling the guest's own country (a Singapore
      // restaurant hears "9750 8007"), full international number otherwise.
      callback_number: req.contactPhone
        ? contactNumberForCall(req.contactPhone, req.phoneNumber)
        : "not available",
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
