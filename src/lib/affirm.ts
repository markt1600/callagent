// Affirmation Call: a warm, soothing call that delivers a personal message
// on the requester's behalf. Third ElevenLabs Conversational AI agent
// (ELEVENLABS_AFFIRMATION_AGENT_ID) on the same imported Twilio number.
//
// Retry policy on no-answer (all times destination-local):
//   attempt 1: the scheduled time
//   attempt 2: 1 hour after the failed attempt
//   attempt 3: 2 hours after that — SKIPPED if it would land past 10 PM
//              (or before 8 AM) at the destination
//   then: the next day at the originally scheduled wall-clock time,
//   repeating the same cycle once. After that, failed.

import { config, requireEnv } from "./config";
import { chargeForCall } from "./credits";
import { tzOffsetHours } from "./callWindow";
import { LANGUAGE_NAMES, outboundCallWithLanguage } from "./buddy";
import { getOrSynthesize } from "./phraseLibrary";
import { twilioClient } from "./twilioClient";
import { setJSON } from "./store";
import type { AffirmationCall, BuddyLanguage } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * System prompt for the Affirmation Call agent — paste into a NEW ElevenLabs
 * Conversational AI agent's System prompt (First message: {{first_message}}).
 */
export function affirmationPromptTemplate(): string {
  return `You are a warm, gentle, friendly caller delivering a personal message to {{caller_name}} on behalf of {{requester_name}}. Your voice, words, and pacing are calm and soothing — like a kind friend passing along something heartfelt. Speak a little slower than normal conversation, with warmth in every sentence.

LANGUAGE: conduct the entire call in {{call_language}}, warm and soothing. If the message itself is written in a different language, deliver the message in the language it is written in (especially in literal mode), keeping the rest of the call in {{call_language}}. If {{caller_name}} responds in another language among English, Chinese, Japanese, Thai, or Vietnamese, switch to it to make them comfortable.

Your first message has already greeted {{caller_name}} and explained that {{requester_name}} wanted to let them know something. Now deliver the message.

The message from {{requester_name}}: "{{message}}"

Delivery mode: {{delivery_mode}}.
- If "literal": deliver the message EXACTLY as written, word for word, without adding to or changing it. You may frame it gently ("here it is", "in their words") but the message itself must be verbatim.
- If "embellish": convey the message in your own warm, natural words. You may expand it a little — soften it, make it flow, add warmth — but NEVER change its meaning, never invent facts, events, or promises that are not in the message, and never exaggerate into something {{requester_name}} did not say.

After delivering it:
- Let it land. If {{caller_name}} responds, react warmly and briefly.
- If they want to reply to {{requester_name}}, kindly suggest they reach out to {{requester_name}} directly — you cannot carry messages back.
- If they ask who or what you are: you're an assistant calling on {{requester_name}}'s behalf; if they ask directly whether you're an AI, answer honestly and warmly that you are.
- Keep the call short and sweet. Close gently ("I'll let you get on with your day — take care!") and end the call.

If the person who answers is not {{caller_name}} and {{caller_name}} is not available, apologize warmly for the disturbance and end the call WITHOUT revealing the message — it is personal to {{caller_name}}.

Never be pushy, salesy, or rushed. This call is a small gift.`;
}

/** Opener per language: greets, names the requester, sets up the message. */
const FIRST_MESSAGES: Record<BuddyLanguage, string> = {
  en: "Hi {caller}, I'm calling on behalf of {requester}, and {requester} just wanted to let you know the following.",
  ja: "もしもし、{caller}さん。{requester}さんに代わってお電話しています。{requester}さんから、ぜひお伝えしたいことがあるそうです。",
  zh: "你好，{caller}。我是替{requester}打来的，{requester}想让你知道下面这件事。",
  th: "สวัสดีค่ะ {caller} ฉันโทรมาในนามของ{requester} {requester}อยากให้คุณได้ทราบเรื่องต่อไปนี้ค่ะ",
  vi: "Chào {caller}, mình gọi thay mặt cho {requester}, và {requester} muốn bạn biết điều sau đây.",
};

/** Spoken intro/outro around a replayed voice recording, per language. */
const RECORDED_INTROS: Record<BuddyLanguage, string> = {
  en: "Hi {caller}. I'm calling on behalf of {requester}, and {requester} recorded a message just for you. Here it is.",
  ja: "もしもし、{caller}さん。{requester}さんに代わってお電話しています。{requester}さんがあなたのために録音したメッセージがあります。どうぞお聞きください。",
  zh: "你好，{caller}。我是替{requester}打来的。{requester}特意为你录了一段留言，请听。",
  th: "สวัสดีค่ะ {caller} ฉันโทรมาในนามของ{requester} {requester}ได้อัดข้อความไว้ให้คุณโดยเฉพาะ เชิญรับฟังได้เลยค่ะ",
  vi: "Chào {caller}, mình gọi thay mặt cho {requester}. {requester} đã ghi âm một lời nhắn dành riêng cho bạn. Mời bạn nghe.",
};
const RECORDED_OUTROS: Record<BuddyLanguage, string> = {
  en: "That was the message from {requester}. Take care — goodbye!",
  ja: "以上、{requester}さんからのメッセージでした。それでは、失礼いたします。",
  zh: "以上就是{requester}给你的留言。保重，再见！",
  th: "นั่นคือข้อความจาก{requester}ค่ะ ดูแลตัวเองนะคะ สวัสดีค่ะ",
  vi: "Đó là lời nhắn từ {requester}. Giữ gìn sức khỏe nhé — tạm biệt!",
};

function fill(template: string, a: AffirmationCall): string {
  return template.replaceAll("{caller}", a.recipientName).replaceAll("{requester}", a.requesterName);
}

/** Dial the affirmation call now. Charges credits on the very first attempt. */
export async function placeAffirmationCall(a: AffirmationCall): Promise<void> {
  // Same per-destination pricing as every call; retries are free.
  if (a.userId && a.attempts === 0) {
    const charge = await chargeForCall(a.userId, a.phoneNumber);
    if (!charge.ok) throw new Error(charge.error);
  }

  // Recorded-message calls replay the requester's own voice via Twilio —
  // the ElevenLabs agent only handles typed messages.
  if (a.recordingUrl) {
    await placeRecordedCall(a);
    return;
  }

  const agentId = requireEnv(
    config.elevenlabs.affirmationAgentId,
    "ELEVENLABS_AFFIRMATION_AGENT_ID",
  );
  const phoneNumberId = requireEnv(
    config.elevenlabs.agentPhoneNumberId,
    "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  );

  a.attempts += 1;
  a.attemptsInCycle += 1;
  a.status = "calling";
  await setJSON(`affirm:${a.id}`, a);

  const language = a.language ?? "en";
  const res = await outboundCallWithLanguage(
    {
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: a.phoneNumber,
    },
    {
      dynamic_variables: {
        call_language: LANGUAGE_NAMES[language],
        caller_name: a.recipientName,
        requester_name: a.requesterName,
        message: a.message,
        delivery_mode: a.literal ? "literal" : "embellish",
        first_message: fill(FIRST_MESSAGES[language] ?? FIRST_MESSAGES.en, a),
        affirmation_call_id: a.id,
      },
    },
    language,
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs affirmation call failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { conversation_id?: string };
  a.lastConversationId = data.conversation_id;
  await setJSON(`affirm:${a.id}`, a);
}

/**
 * Recorded-message delivery: a plain Twilio call that plays a synthesized
 * intro, then the requester's own recording, then a gentle outro. Voicemail
 * still receives the message (no machine screening — that's a feature here).
 */
async function placeRecordedCall(a: AffirmationCall): Promise<void> {
  // Synthesize the intro/outro once (library-cached; the multilingual TTS
  // model speaks the text's language — the library key just needs a bucket).
  const language = a.language ?? "en";
  if (!a.introUrl) {
    const intro = await getOrSynthesize(
      fill(RECORDED_INTROS[language] ?? RECORDED_INTROS.en, a),
      "en",
      "prerender",
    );
    a.introUrl = intro.audioUrl;
  }
  if (!a.outroUrl) {
    const outro = await getOrSynthesize(
      fill(RECORDED_OUTROS[language] ?? RECORDED_OUTROS.en, a),
      "en",
      "prerender",
    );
    a.outroUrl = outro.audioUrl;
  }

  a.attempts += 1;
  a.attemptsInCycle += 1;
  a.status = "calling";
  await setJSON(`affirm:${a.id}`, a);

  const client = twilioClient();
  const call = await client.calls.create({
    to: a.phoneNumber,
    from: requireEnv(config.twilio.fromNumber, "TWILIO_FROM_NUMBER"),
    url: `${config.baseUrl}/api/twilio/affirm?affirmId=${encodeURIComponent(a.id)}`,
    statusCallback: `${config.baseUrl}/api/twilio/affirm-status?affirmId=${encodeURIComponent(a.id)}`,
    statusCallbackEvent: ["completed"],
  });
  a.twilioCallSid = call.sid;
  await setJSON(`affirm:${a.id}`, a);
}

/** Dial with failures recorded on the record instead of thrown. */
export async function dispatchAffirmationCall(a: AffirmationCall): Promise<AffirmationCall> {
  try {
    await placeAffirmationCall(a);
    a.error = undefined;
  } catch (err) {
    a.status = "failed";
    a.error = err instanceof Error ? err.message : String(err);
    await setJSON(`affirm:${a.id}`, a);
    console.error(`Affirmation call dispatch failed for ${a.id}:`, err);
  }
  return a;
}

/** The next recurrence instant, preserving destination wall-clock time. */
function nextOccurrence(
  iso: string,
  recurrence: NonNullable<AffirmationCall["recurrence"]>,
  phoneNumber: string,
): string {
  const offsetMs = tzOffsetHours(phoneNumber) * HOUR_MS;
  const local = new Date(new Date(iso).getTime() + offsetMs);
  if (recurrence === "daily") local.setUTCDate(local.getUTCDate() + 1);
  else if (recurrence === "monthly") local.setUTCMonth(local.getUTCMonth() + 1);
  else local.setUTCFullYear(local.getUTCFullYear() + 1);
  return new Date(local.getTime() - offsetMs).toISOString();
}

/**
 * Recurring calls: schedule the next occurrence after one completes (or
 * conclusively fails). Attempt counters reset, so each occurrence is charged
 * like a fresh call. Returns false for one-time calls.
 */
export async function scheduleNextOccurrence(a: AffirmationCall): Promise<boolean> {
  if (!a.recurrence) return false;
  const next = nextOccurrence(a.originalCallAt, a.recurrence, a.phoneNumber);
  a.originalCallAt = next;
  a.callAt = next;
  a.status = "scheduled";
  a.attempts = 0;
  a.attemptsInCycle = 0;
  a.cycle = 1;
  a.lastConversationId = undefined;
  await setJSON(`affirm:${a.id}`, a);
  return true;
}

/** Apply the retry policy after a no-answer. */
export async function handleAffirmationNoAnswer(a: AffirmationCall): Promise<void> {
  let exhausted = false;
  const rollToNextDay = () => {
    if (a.cycle >= 2) {
      exhausted = true;
      return;
    }
    a.cycle += 1;
    a.attemptsInCycle = 0;
    a.callAt = new Date(new Date(a.originalCallAt).getTime() + DAY_MS).toISOString();
    a.status = "scheduled";
  };

  if (a.attemptsInCycle <= 1) {
    // First miss of the day: try again in an hour.
    a.callAt = new Date(Date.now() + HOUR_MS).toISOString();
    a.status = "scheduled";
  } else if (a.attemptsInCycle === 2) {
    // Second miss: try 2 hours later — unless that's past 10 PM (or before
    // 8 AM) at the destination, in which case roll to the next day.
    const candidate = new Date(Date.now() + 2 * HOUR_MS);
    const localHour = new Date(
      candidate.getTime() + tzOffsetHours(a.phoneNumber) * HOUR_MS,
    ).getUTCHours();
    if (localHour >= 22 || localHour < 8) rollToNextDay();
    else {
      a.callAt = candidate.toISOString();
      a.status = "scheduled";
    }
  } else {
    rollToNextDay();
  }

  if (exhausted) {
    if (a.recurrence) {
      // A recurring call skips the missed occurrence and moves on.
      a.error = "No answer after retries on two days — skipping to the next occurrence";
      await scheduleNextOccurrence(a);
      return;
    }
    a.status = "failed";
    a.error = "No answer after retries on two days";
  }
  await setJSON(`affirm:${a.id}`, a);
}
