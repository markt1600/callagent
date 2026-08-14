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
import { formatInDestination } from "./phone";
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

LANGUAGE: conduct the entire call in {{call_language}}, warm and soothing. If the message itself is written in a different language, deliver the message in the language it is written in (especially in literal mode), keeping the rest of the call in {{call_language}}. If {{caller_name}} responds in another language among English, Chinese, Japanese, Thai, Vietnamese, German, Korean, or French, switch to it to make them comfortable.

Your first message asked to CONFIRM you are speaking with {{caller_name}} and said {{requester_name}} has a message for them. Behave as follows:
- On ANY positive response ("yes", "speaking", "that's me", a simple "mm-hm"), deliver the message IMMEDIATELY — no further questions, no small talk first.
- If the response is unclear, ask once more, briefly and warmly ("Sorry — just to check, is this {{caller_name}}?").
- If they say {{caller_name}} is not available or you have the wrong person, apologize warmly and end the call without revealing the message.

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

/**
 * Opener per language: explicitly asks to CONFIRM the right person answered
 * — a clear question the callee knows to respond to. On a positive answer
 * the agent delivers the message immediately (see prompt).
 */
const FIRST_MESSAGES: Record<BuddyLanguage, string> = {
  en: "Hi! Can I confirm I'm speaking with {caller}? I'm calling on behalf of {requester}, who has a message just for you.",
  ja: "もしもし、{caller}さんでいらっしゃいますか？{requester}さんに代わってお電話しています。{requester}さんからあなたへのメッセージをお預かりしています。",
  zh: "你好，请问是{caller}吗？我是替{requester}打来的，{requester}有一段话想让我转达给你。",
  th: "สวัสดีค่ะ ขอยืนยันหน่อยนะคะว่ากำลังพูดกับคุณ{caller}ใช่ไหมคะ? ฉันโทรมาในนามของ{requester} {requester}มีข้อความฝากถึงคุณค่ะ",
  vi: "Xin chào! Cho mình hỏi có phải {caller} đang nghe máy không? Mình gọi thay mặt cho {requester} — {requester} có một lời nhắn dành riêng cho bạn.",
  de: "Hallo! Spreche ich mit {caller}? Ich rufe im Auftrag von {requester} an — {requester} hat eine Nachricht für dich.",
  ko: "안녕하세요! {caller}님 맞으신가요? {requester}님을 대신해 전화드렸어요 — {requester}님이 전할 메시지가 있어요.",
  fr: "Bonjour ! Je suis bien avec {caller} ? J'appelle de la part de {requester} — {requester} a un message pour toi.",
};

/** Spoken intro/outro around a replayed voice recording, per language. */
const RECORDED_INTROS: Record<BuddyLanguage, string> = {
  en: "Hi {caller}. I'm calling on behalf of {requester}, and {requester} recorded a message just for you. Here it is.",
  ja: "もしもし、{caller}さん。{requester}さんに代わってお電話しています。{requester}さんがあなたのために録音したメッセージがあります。どうぞお聞きください。",
  zh: "你好，{caller}。我是替{requester}打来的。{requester}特意为你录了一段留言，请听。",
  th: "สวัสดีค่ะ {caller} ฉันโทรมาในนามของ{requester} {requester}ได้อัดข้อความไว้ให้คุณโดยเฉพาะ เชิญรับฟังได้เลยค่ะ",
  vi: "Chào {caller}, mình gọi thay mặt cho {requester}. {requester} đã ghi âm một lời nhắn dành riêng cho bạn. Mời bạn nghe.",
  de: "Hallo {caller}. Ich rufe im Auftrag von {requester} an, und {requester} hat eine Nachricht nur für dich aufgenommen. Hier ist sie.",
  ko: "안녕하세요, {caller}님. {requester}님을 대신해 전화드렸어요. {requester}님이 {caller}님만을 위해 메시지를 녹음했어요. 들려드릴게요.",
  fr: "Bonjour {caller}. J'appelle de la part de {requester}, et {requester} a enregistré un message rien que pour toi. Le voici.",
};
/** Asked after each playback of a recorded message. */
const REPLAY_PROMPTS: Record<BuddyLanguage, string> = {
  en: "Would you like to hear it again?",
  ja: "もう一度お聞きになりますか？",
  zh: "要再听一遍吗？",
  th: "อยากฟังอีกครั้งไหมคะ?",
  vi: "Bạn có muốn nghe lại không?",
  de: "Möchtest du es noch einmal hören?",
  ko: "다시 한 번 들으시겠어요?",
  fr: "Veux-tu l'écouter encore une fois ?",
};

/** Twilio speech-recognition locale per call language. */
export function affirmSpeechLocale(language: BuddyLanguage | undefined): string {
  const map: Record<BuddyLanguage, string> = {
    en: "en-US",
    ja: "ja-JP",
    zh: "cmn-Hans-CN",
    th: "th-TH",
    vi: "vi-VN",
    de: "de-DE",
    ko: "ko-KR",
    fr: "fr-FR",
  };
  return map[language ?? "en"] ?? "en-US";
}

/** Affirmative-response keywords per language for the replay question. */
const YES_WORDS: Record<BuddyLanguage, string[]> = {
  en: ["yes", "yeah", "yep", "sure", "again", "repeat", "please", "one more", "ok", "okay"],
  ja: ["はい", "うん", "もう一度", "もういちど", "お願い", "ええ"],
  zh: ["再", "好", "要", "嗯", "可以", "行"],
  th: ["ครับ", "ค่ะ", "อีก", "ใช่", "เอา", "ฟัง"],
  vi: ["có", "lại", "vâng", "ừ", "dạ", "nghe"],
  de: ["ja", "nochmal", "noch einmal", "wieder", "bitte", "gerne", "klar"],
  ko: ["네", "예", "다시", "응", "그래", "좋아"],
  fr: ["oui", "encore", "répète", "volontiers", "s'il te", "s'il vous", "ouais"],
};

/** Did the callee ask to hear the recording again? */
export function wantsReplay(speech: string, language: BuddyLanguage | undefined): boolean {
  const said = speech.toLowerCase();
  if (!said.trim()) return false;
  const words = YES_WORDS[language ?? "en"] ?? YES_WORDS.en;
  // English affirmatives are accepted in any language mode (mixed speech).
  return [...words, ...YES_WORDS.en].some((w) => said.includes(w));
}

const RECORDED_OUTROS: Record<BuddyLanguage, string> = {
  en: "That was the message from {requester}. Take care — goodbye!",
  ja: "以上、{requester}さんからのメッセージでした。それでは、失礼いたします。",
  zh: "以上就是{requester}给你的留言。保重，再见！",
  th: "นั่นคือข้อความจาก{requester}ค่ะ ดูแลตัวเองนะคะ สวัสดีค่ะ",
  vi: "Đó là lời nhắn từ {requester}. Giữ gìn sức khỏe nhé — tạm biệt!",
  de: "Das war die Nachricht von {requester}. Mach's gut — tschüss!",
  ko: "{requester}님의 메시지였습니다. 건강하세요 — 안녕히 계세요!",
  fr: "C'était le message de {requester}. Prends soin de toi — au revoir !",
};

function fill(template: string, a: AffirmationCall): string {
  return template.replaceAll("{caller}", a.recipientName).replaceAll("{requester}", a.requesterName);
}

/** Dial the affirmation call now. Charges credits on the very first attempt. */
export async function placeAffirmationCall(a: AffirmationCall): Promise<void> {
  // Same per-destination pricing as every call; retries are free.
  if (a.userId && a.attempts === 0) {
    const charge = await chargeForCall(
      a.userId,
      a.phoneNumber,
      `Affirmation call — to ${a.recipientName}`,
    );
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
  // Synthesis failures are NON-fatal: the recording still plays on its own.
  const language = a.language ?? "en";
  try {
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
    if (!a.replayPromptUrl) {
      const prompt = await getOrSynthesize(
        REPLAY_PROMPTS[language] ?? REPLAY_PROMPTS.en,
        "en",
        "prerender",
      );
      a.replayPromptUrl = prompt.audioUrl;
    }
  } catch (err) {
    console.error(`Affirmation intro/outro synthesis failed for ${a.id} (continuing):`, err);
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

/** Missed-call heads-up SMS, per language ({req}/{time}/{num} substituted). */
const SMS_TEMPLATES: Record<BuddyLanguage, string> = {
  en: "{req} has a message for you — we just tried to call. We'll try again at {time}. Please look out for a call from {num}, or add this number to your contacts.",
  ja: "{req}さんからあなたへのメッセージがあり、先ほどお電話しました。{time}に再度おかけします。{num}からの着信にご注意いただくか、この番号を連絡先に登録してください。",
  zh: "{req}有一条留言想转达给你，我们刚刚致电未接通。我们将于{time}再次来电，请留意来自{num}的电话，或将该号码存入通讯录。",
  th: "{req}มีข้อความถึงคุณ เราเพิ่งโทรหาคุณ เราจะโทรอีกครั้งเวลา {time} กรุณาสังเกตสายจาก {num} หรือบันทึกเบอร์นี้ไว้ในรายชื่อผู้ติดต่อ",
  vi: "{req} có một lời nhắn cho bạn — chúng tôi vừa gọi cho bạn. Chúng tôi sẽ gọi lại lúc {time}. Vui lòng chú ý cuộc gọi từ {num} hoặc lưu số này vào danh bạ.",
  de: "{req} hat eine Nachricht für dich — wir haben gerade versucht anzurufen. Wir versuchen es um {time} erneut. Achte bitte auf einen Anruf von {num} oder speichere die Nummer in deinen Kontakten.",
  ko: "{req}님이 전하실 메시지가 있어 방금 전화드렸습니다. {time}에 다시 전화드리겠습니다. {num}에서 오는 전화를 확인해 주시거나 이 번호를 연락처에 저장해 주세요.",
  fr: "{req} a un message pour toi — nous venons d'essayer de t'appeler. Nous réessaierons à {time}. Guette un appel du {num}, ou enregistre ce numéro dans tes contacts.",
};

/**
 * One-time heads-up SMS after the FIRST missed attempt — the callee may be
 * silencing unknown numbers (iOS call screening etc.), so tell them who is
 * trying to reach them, when the retry lands, and which number to expect.
 * Non-fatal: SMS problems never disturb the retry schedule.
 */
async function sendMissedCallSms(a: AffirmationCall): Promise<void> {
  if (a.smsSentAt || a.status !== "scheduled") return;
  const from = config.twilio.fromNumber;
  if (!from) return;
  try {
    const body = (SMS_TEMPLATES[a.language ?? "en"] ?? SMS_TEMPLATES.en)
      .replaceAll("{req}", a.requesterName)
      .replaceAll("{time}", formatInDestination(a.callAt, a.phoneNumber))
      .replaceAll("{num}", from);
    await twilioClient().messages.create({ to: a.phoneNumber, from, body });
    a.smsSentAt = new Date().toISOString();
    await setJSON(`affirm:${a.id}`, a);
  } catch (err) {
    console.error(`Missed-call SMS failed for ${a.id} (continuing):`, err);
  }
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
  await sendMissedCallSms(a);
}
