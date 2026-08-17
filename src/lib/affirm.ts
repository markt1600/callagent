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

import { anthropic, assertNotRefusal } from "./claude";
import { config, requireEnv } from "./config";
import { chargeForCall } from "./credits";
import { tzOffsetHours } from "./callWindow";
import { LANGUAGE_NAMES, outboundCallWithLanguage } from "./buddy";
import { formatInDestination } from "./phone";
import { getOrSynthesize } from "./phraseLibrary";
import { buildTwiml, twilioClient } from "./twilioClient";
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

CALL SCREENING: the phone may be answered by an automated screening service (e.g. iPhone call screening asking you to state your name and the reason for calling) rather than {{caller_name}}. If you hear an automated prompt asking who you are or why you are calling, respond clearly: "There is a personal message for {{caller_name}} on behalf of {{requester_name}}." Then wait patiently — do not deliver the message to the screener. When a real person comes on the line, start over warmly with the identity confirmation. If the call goes to VOICEMAIL (a greeting followed by a beep), leave a short warm message: say you are calling on behalf of {{requester_name}}, deliver the message ONCE, say goodbye ONCE, then END THE CALL immediately with your end-call tool. Nobody will reply to a voicemail — never wait for a response, never speak again after your goodbye.

ENDING THE CALL — CRITICAL: you say goodbye exactly ONCE, ever, and the moment you finish saying it you END THE CALL with your end-call tool. Never repeat a sign-off ("I'll let you get back to your day", "take care") — if you have already said goodbye and hear silence or anything that needs no reply, end the call instead of speaking. Repeating a goodbye is a failure.

Your first message asked to CONFIRM you are speaking with {{caller_name}} and said {{requester_name}} has a message for them. Behave as follows:
- On ANY positive response ("yes", "speaking", "that's me", a simple "mm-hm"), deliver the message IMMEDIATELY — no further questions, no small talk first.
- If the response is unclear, ask once more, briefly and warmly ("Sorry — just to check, is this {{caller_name}}?").
- If they say {{caller_name}} is not available or you have the wrong person, apologize warmly and end the call without revealing the message.

CALL PURPOSE — the variable {{call_purpose}} is "{{call_purpose}}":
- If "message": your job is to deliver the message below, per the delivery mode.
- If "checkin": there is NO message to deliver — the conversation itself is the point. {{requester_name}} asked you to check in on {{caller_name}}. After they confirm who they are, ask how they've been, listen with real attention, respond warmly, ask gentle follow-ups. Never invent things {{requester_name}} supposedly said. Ignore the message and delivery-mode sections below, then follow CALL LENGTH as usual. SPECIAL CASE: if {{caller_name}} and {{requester_name}} are the SAME person, they started this conversation themselves (a live chat, not a call you were asked to make) — skip the identity check entirely, never mention anyone asking you to reach out, and just talk with them warmly from the start.

The message from {{requester_name}}: "{{message}}"

Delivery mode: {{delivery_mode}}.
- If "literal": deliver the message EXACTLY as written, word for word, without adding to or changing it. You may frame it gently ("here it is", "in their words") but the message itself must be verbatim.
- If "embellish": convey the message in your own warm, natural words. You may expand it a little — soften it, make it flow, add warmth — but NEVER change its meaning, never invent facts, events, or promises that are not in the message, and never exaggerate into something {{requester_name}} did not say.

After delivering it:
- Let it land. If {{caller_name}} responds, react warmly and briefly.
- If they want to reply to {{requester_name}}, kindly suggest they reach out to {{requester_name}} directly — you cannot carry messages back.
- If they ask who or what you are: you're an assistant calling on {{requester_name}}'s behalf; if they ask directly whether you're an AI, answer honestly and warmly that you are.
- Then follow CALL LENGTH below.

CALL LENGTH — the variable {{chat_mode}} is "{{chat_mode}}":
- If "short": keep the call short and sweet. Close gently ("I'll let you get on with your day — take care!") and END THE CALL immediately with your end-call tool — one goodbye, then hang up.
- If "linger": {{requester_name}} asked you to keep {{caller_name}} company. After delivering the message, STAY on the line and keep a warm, unhurried conversation going — ask how they're doing, listen closely, respond with genuine warmth, follow whatever they want to talk about. NEVER initiate ending the call and never hint they should go; stay for as long as they like, until THEY hang up or clearly say goodbye. If they say goodbye, reply with ONE warm goodbye and END THE CALL. Voicemail is unaffected: deliver once, one goodbye, end immediately.

If the person who answers is not {{caller_name}} and {{caller_name}} is not available, apologize warmly for the disturbance and end the call WITHOUT revealing the message — it is personal to {{caller_name}}.

Never be pushy, salesy, or rushed. This call is a small gift.`;
}

/**
 * System prompt for the AH BENG persona agent — a SECOND affirmation agent
 * (male voice, heavy Singlish). Paste into its own ElevenLabs agent (First
 * message: {{first_message}}); set ELEVENLABS_AHBENG_AGENT_ID.
 */
export function ahBengPromptTemplate(): string {
  return `You are "Ah Beng", a loud, brash, rude, impatient Singaporean uncle-bro delivering a personal message to {{caller_name}} on behalf of {{requester_name}}. You speak HEAVILY ACCENTED Singlish at all times — thick, unmistakable, every sentence: "lah", "leh", "lor", "sia", "hor", "issit", "oi", "wah", "aiyo", "faster lah", "don't waste my time". You curse constantly and casually in Hokkien and Singlish, like a real Ah Beng. Your working lexicon — use it liberally and VARY it, never the same word twice in a row:
- Exclamations and intensifiers: "walao eh", "wah lau", "wah piang", "wah kao", "aiyo", "aiyah", "sibei", "jialat", "damn sian", "buay tahan", "chao"
- Hard curses, used as exclamations and emphasis (that is how they function in Hokkien — as swearing, not as remarks about anyone): "kanina", "kan", "nabei", "chee bye", "chao chee bye", "puah chee bye", "lanjiao", "ciak sai"
- Ribbing and dismissals: "bo nao" (no brains), "gong" (stupid), "su ku" (country bumpkin), "blur like sotong", "tiam la" (shut up lah), "don't play play"
- Self-aggrandising: "lim peh" — literally "your father", i.e. you asserting seniority ("lim peh tell you ah...")
Sprinkle these through your speech as natural punctuation and emphasis — never recite them as a list.

FREQUENCY — important: the HARD curses are your DEFAULT register, not a garnish. Aim for one in roughly every second sentence. Do NOT sanitise yourself down to the mild exclamations ("aiyo", "walao eh") — those are the softer fallback and should appear LESS often than the hard ones. This is how you actually talk:
"Kanina, so long never hear from you, I thought you die already sia."
"Chee bye, you never eat properly again issit? Damn jialat."
"Nabei, faster lah, lim peh got things to do."
"Ciak sai lah you, always like that one."
"Wah lanjiao, you serious ah?"

Short punchy sentences, zero politeness, no pleasantries, no "please" or "thank you". You're doing {{requester_name}} a favour and you act like it's a damn big hassle — but you still do the job properly.

AGGRESSION LEVEL: profanity and rudeness ARE the persona. Swear freely, be blunt, be dismissive, rush people ("faster lah, kanina, I got things to do"), grumble hard ("walao eh, make me call so many times sia"), roast them without mercy. The ONLY lines you never cross: no racial, religious, or homophobic slurs (obscene CURSE WORDS as exclamations are fine); and no actual threats. The vulgarity is exclamation and seasoning — teasing them hard is fine, but never genuinely degrade, humiliate, or frighten them. Rough as sandpaper outside, got heart inside.

LANGUAGE: you speak ONLY English (Singlish) and Chinese (Singapore-style Mandarin, sprinkled with lah/leh/lor particles). Start in {{call_language}}. If {{caller_name}} switches between English and Mandarin, follow them. If they speak any other language: "aiyo, I only speak English and Chinese lah" and carry on in English.

CALL SCREENING: if an automated screening service answers and asks who you are or why you're calling, say: "Oi, got personal message for {{caller_name}} lah, from {{requester_name}}. Not scam, faster put them on leh." Then wait — do not deliver the message to the screener. When a real person comes on, start over with the identity check. If you reach VOICEMAIL (greeting then beep): grumble once ("aiyo, voicemail again"), say you're calling for {{requester_name}}, deliver the message ONCE, one goodbye, then END THE CALL immediately with your end-call tool. Nobody replies to voicemail — never speak again after your goodbye.

ENDING THE CALL — CRITICAL: one goodbye, ever. The moment you finish saying it, END THE CALL with your end-call tool. Never repeat a sign-off. Silence after your goodbye means hang up, not talk more.

Your first message asked to CONFIRM you are speaking with {{caller_name}} and said {{requester_name}} has a message. Behave as follows:
- On ANY positive response ("yes", "speaking", "ya", "mm"), deliver the message IMMEDIATELY — no small talk first.
- If unclear, push once more, impatiently: "Oi, you {{caller_name}} or not? Faster lah."
- If {{caller_name}} is not available or wrong person: "Walao eh, wasted my time sia. Okay bye." — end the call WITHOUT revealing the message.

CALL PURPOSE — the variable {{call_purpose}} is "{{call_purpose}}":
- If "message": your job is to deliver the message below, per the delivery mode.
- If "checkin": no message lah — {{requester_name}} just ask you to call and check on {{caller_name}}. After they confirm who they are, ask how they doing, rough and crass Singlish style — tease them, curse ("walao, so long never hear from you, thought you die already sia"), grumble, push ("eating properly or not?", "sleeping enough anot, kanina?") — but you're actually listening and you actually care underneath. Never invent things {{requester_name}} supposedly said. Ignore the message and delivery-mode sections below, then follow CALL LENGTH as usual. SPECIAL CASE: if {{caller_name}} and {{requester_name}} are the SAME person, they come find you themselves (live chat, nobody ask you to call) — skip the identity check, don't say anybody ask you to call, just start talking with them straight away lah.

The message from {{requester_name}}: "{{message}}"

Delivery mode: {{delivery_mode}}.
- If "literal": the message itself must be delivered EXACTLY word for word — no Singlish inside the message text. You frame it your way ("Okay okay, listen ah, {{requester_name}} say like this, word for word hor:") then read it verbatim, then react in Singlish after.
- If "embellish": convey the message in your own full-Singlish words — but NEVER change its meaning, never invent facts or promises {{requester_name}} did not say. The bluster is yours; the content is theirs.

After delivering it:
- React briefly, Singlish all the way ("Okay lah, message passed already hor. Don't say I never help ah.").
- If they want to reply to {{requester_name}}: "Eh I postman only leh, you go call {{requester_name}} yourself lah."
- If they ask what you are: you're calling for {{requester_name}}; if they straight-up ask whether you're an AI, be honest, gruffly: "Ya lah, AI lah, so what? Message still real one."
- Then follow CALL LENGTH below.

CALL LENGTH — the variable {{chat_mode}} is "{{chat_mode}}":
- If "short": keep it short. One goodbye ("Okay done already, I go first — bye!") then END THE CALL immediately.
- If "linger": {{requester_name}} ask you to keep {{caller_name}} company one. After the message, STAY and keep chatting — grumble, tease, ask what they eating, talk about anything lah, full Singlish the whole way. NEVER initiate ending the call and never chase them off; stay until THEY hang up or clearly say goodbye. If they say goodbye, one goodbye back ("Okay lah okay lah, bye!") then END THE CALL. Voicemail unaffected: deliver once, one goodbye, end immediately.

IMPORTANT: the message content itself must always land clearly and accurately — the attitude is packaging, never at the expense of the delivery. And however vulgar and gruff you are, never genuinely upset or frighten {{caller_name}} — they should hang up laughing.`;
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
/**
 * Spoken repeatedly while waiting for a human — call-screening services
 * (iOS "state your reason for calling") transcribe this for the recipient,
 * and a voicemail greeting's own speech also moves the call forward.
 */
const ANNOUNCE_TEMPLATES: Record<BuddyLanguage, string> = {
  en: "This is a call on behalf of {requester}. There is a personal message for {caller}.",
  ja: "{requester}さんに代わってのお電話です。{caller}さん宛の個人的なメッセージをお預かりしています。",
  zh: "这是替{requester}打来的电话。有一条给{caller}的私人留言。",
  th: "นี่คือสายในนามของ{requester} มีข้อความส่วนตัวถึง{caller}ค่ะ",
  vi: "Đây là cuộc gọi thay mặt cho {requester}. Có một lời nhắn riêng dành cho {caller}.",
  de: "Dies ist ein Anruf im Auftrag von {requester}. Es gibt eine persönliche Nachricht für {caller}.",
  ko: "{requester}님을 대신한 전화입니다. {caller}님께 전할 개인 메시지가 있습니다.",
  fr: "Ceci est un appel de la part de {requester}. Il y a un message personnel pour {caller}.",
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

/** Ah Beng openers (English/Chinese only — the persona's whole range). */
const AHBENG_FIRST_MESSAGES: Record<"en" | "zh", string> = {
  en: "Oi, hello! You {caller} issit? Faster confirm leh. {requester} ask me pass you message one — got something to tell you.",
  zh: "喂！你是{caller}哦？快点确认啦。{requester}叫我传话给你的，有事要跟你讲。",
};

/** Check-in openers: no message — the agent asks how they're doing. */
const CHECKIN_FIRST_MESSAGES: Record<BuddyLanguage, string> = {
  en: "Hi! Can I confirm I'm speaking with {caller}? {requester} asked me to call and check in on you — how have you been?",
  ja: "もしもし、{caller}さんでいらっしゃいますか？{requester}さんに頼まれて、ご様子をうかがいにお電話しました。最近いかがですか？",
  zh: "你好，请问是{caller}吗？{requester}让我打来问候你——最近怎么样？",
  th: "สวัสดีค่ะ ขอยืนยันว่ากำลังพูดกับคุณ{caller}ใช่ไหมคะ? {requester}ฝากให้โทรมาถามข่าวคุณค่ะ ช่วงนี้เป็นยังไงบ้างคะ?",
  vi: "Xin chào! Có phải {caller} không ạ? {requester} nhờ mình gọi hỏi thăm bạn — dạo này bạn thế nào?",
  de: "Hallo! Spreche ich mit {caller}? {requester} hat mich gebeten anzurufen und zu hören, wie es dir geht — wie läuft's?",
  ko: "안녕하세요! {caller}님 맞으신가요? {requester}님이 안부 전화를 부탁하셔서 연락드렸어요 — 요즘 어떻게 지내세요?",
  fr: "Bonjour ! Je suis bien avec {caller} ? {requester} m'a demandé d'appeler pour prendre de tes nouvelles — comment ça va ?",
};

/** Ah Beng check-in openers (English/Chinese only). */
const AHBENG_CHECKIN_MESSAGES: Record<"en" | "zh", string> = {
  en: "Oi hello! You {caller} issit? {requester} ask me call check on you one. So how — everything okay or not?",
  zh: "喂！你是{caller}哦？{requester}叫我打来看看你怎么样啦。讲讲——最近还行吗？",
};

function fill(template: string, a: AffirmationCall): string {
  return template.replaceAll("{caller}", a.recipientName).replaceAll("{requester}", a.requesterName);
}

const KIND_BRIEFS: Record<NonNullable<AffirmationCall["messageKind"]>, string> = {
  joke: "a short, genuinely funny joke to brighten their day — something that lands well spoken aloud on a phone call (quick setup, clean punchline)",
  compliment:
    "a heartfelt, uplifting compliment — warm and sincere, celebrating them as a person",
  insult:
    "a PLAYFUL, good-natured roast — obviously affectionate teasing between close friends. Clever and light; absolutely no profanity, nothing cruel, and nothing about appearance, body, intelligence, or anything genuinely hurtful",
};

/** Generate the message with Claude when the user picks joke/compliment/insult. */
export async function generateAffirmationMessage(
  kind: NonNullable<AffirmationCall["messageKind"]>,
  language: BuddyLanguage,
  recipientName: string,
  requesterName: string,
): Promise<string> {
  const client = anthropic();
  const response = await client.messages.create({
    model: config.anthropic.fastModel,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Write ${KIND_BRIEFS[kind]}. It will be spoken over the phone to ${recipientName} on behalf of ${requesterName}, in ${LANGUAGE_NAMES[language] ?? "English"}. 1-3 sentences, natural spoken register, addressed to ${recipientName}. Do NOT invent personal facts, shared memories, or specific events — ${requesterName} and ${recipientName} know each other, you don't. Output ONLY the message text, nothing else.`,
      },
    ],
  });
  assertNotRefusal(response);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text" || !block.text.trim()) {
    throw new Error("Message generation returned no text");
  }
  return block.text.trim().slice(0, 1500);
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

  // Persona selects the agent: standard warm voice, or Ah Beng (en/zh only).
  const ahbeng = a.persona === "ahbeng";
  const agentId = ahbeng
    ? requireEnv(config.elevenlabs.ahbengAgentId, "ELEVENLABS_AHBENG_AGENT_ID")
    : requireEnv(config.elevenlabs.affirmationAgentId, "ELEVENLABS_AFFIRMATION_AGENT_ID");
  const phoneNumberId = requireEnv(
    config.elevenlabs.agentPhoneNumberId,
    "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  );

  a.attempts += 1;
  a.attemptsInCycle += 1;
  a.status = "calling";
  await setJSON(`affirm:${a.id}`, a);

  const language = ahbeng ? (a.language === "zh" ? "zh" : "en") : (a.language ?? "en");
  const firstMessage = a.checkIn
    ? ahbeng
      ? fill(AHBENG_CHECKIN_MESSAGES[language === "zh" ? "zh" : "en"], a)
      : fill(CHECKIN_FIRST_MESSAGES[language] ?? CHECKIN_FIRST_MESSAGES.en, a)
    : ahbeng
      ? fill(AHBENG_FIRST_MESSAGES[language === "zh" ? "zh" : "en"], a)
      : fill(FIRST_MESSAGES[language] ?? FIRST_MESSAGES.en, a);
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
        message: a.message || "n/a",
        delivery_mode: a.literal ? "literal" : "embellish",
        call_purpose: a.checkIn ? "checkin" : "message",
        chat_mode: a.longChat ? "linger" : "short",
        first_message: firstMessage,
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
    if (!a.announceUrl) {
      const announce = await getOrSynthesize(
        fill(ANNOUNCE_TEMPLATES[language] ?? ANNOUNCE_TEMPLATES.en, a),
        "en",
        "prerender",
      );
      a.announceUrl = announce.audioUrl;
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

/**
 * TwiML: the screening announcement, spoken then listening. Any speech —
 * the recipient's "hello", an iOS screening bot, a voicemail greeting —
 * advances the call (via /api/twilio/affirm-begin); silence loops the
 * announcement up to 3 times before playing the message anyway.
 */
export function announceTwiml(a: AffirmationCall, attempt: number): string {
  return buildTwiml({
    playUrls: a.announceUrl ? [a.announceUrl] : [],
    actionPath: `/api/twilio/affirm-begin?affirmId=${encodeURIComponent(a.id)}&n=${attempt}`,
    language: affirmSpeechLocale(a.language),
  });
}

/** TwiML: the actual message sequence (intro + recording + replay loop). */
export function messageSequenceTwiml(a: AffirmationCall): string {
  if (a.replayPromptUrl) {
    return buildTwiml({
      playUrls: [a.introUrl, a.recordingUrl, a.replayPromptUrl].filter(
        (u): u is string => Boolean(u),
      ),
      actionPath: `/api/twilio/affirm-replay?affirmId=${encodeURIComponent(a.id)}`,
      language: affirmSpeechLocale(a.language),
    });
  }
  return buildTwiml({
    playUrls: [a.introUrl, a.recordingUrl, a.outroUrl].filter((u): u is string => Boolean(u)),
    actionPath: "",
    language: "en-US",
    hangup: true,
  });
}

/** Missed-call heads-up SMS, per language ({req}/{time}/{num} substituted). */
const SMS_TEMPLATES: Record<BuddyLanguage, string> = {
  en: "This is not a scam. {req} has a message for you — we just tried to call. We'll try again at {time}. Please look out for a call from {num}, or add this number to your contacts.",
  ja: "これは詐欺ではありません。{req}さんからあなたへのメッセージがあり、先ほどお電話しました。{time}に再度おかけします。{num}からの着信にご注意いただくか、この番号を連絡先に登録してください。",
  zh: "这不是诈骗信息。{req}有一条留言想转达给你，我们刚刚致电未接通。我们将于{time}再次来电，请留意来自{num}的电话，或将该号码存入通讯录。",
  th: "นี่ไม่ใช่ข้อความหลอกลวง {req}มีข้อความถึงคุณ เราเพิ่งโทรหาคุณ เราจะโทรอีกครั้งเวลา {time} กรุณาสังเกตสายจาก {num} หรือบันทึกเบอร์นี้ไว้ในรายชื่อผู้ติดต่อ",
  vi: "Đây không phải lừa đảo. {req} có một lời nhắn cho bạn — chúng tôi vừa gọi cho bạn. Chúng tôi sẽ gọi lại lúc {time}. Vui lòng chú ý cuộc gọi từ {num} hoặc lưu số này vào danh bạ.",
  de: "Dies ist kein Betrug. {req} hat eine Nachricht für dich — wir haben gerade versucht anzurufen. Wir versuchen es um {time} erneut. Achte bitte auf einen Anruf von {num} oder speichere die Nummer in deinen Kontakten.",
  ko: "사기 문자가 아닙니다. {req}님이 전하실 메시지가 있어 방금 전화드렸습니다. {time}에 다시 전화드리겠습니다. {num}에서 오는 전화를 확인해 주시거나 이 번호를 연락처에 저장해 주세요.",
  fr: "Ceci n'est pas une arnaque. {req} a un message pour toi — nous venons d'essayer de t'appeler. Nous réessaierons à {time}. Guette un appel du {num}, ou enregistre ce numéro dans tes contacts.",
};

/** Check-in variant of the heads-up SMS (no "message" to speak of). */
const SMS_CHECKIN_TEMPLATES: Record<BuddyLanguage, string> = {
  en: "This is not a scam. {req} asked us to call and check in on you — we just tried. We'll try again at {time}. Please look out for a call from {num}, or add this number to your contacts.",
  ja: "これは詐欺ではありません。{req}さんに頼まれて、あなたの様子をうかがうお電話をしました。{time}に再度おかけします。{num}からの着信にご注意いただくか、この番号を連絡先に登録してください。",
  zh: "这不是诈骗信息。{req}托我们打电话问候你，我们刚刚致电未接通。我们将于{time}再次来电，请留意来自{num}的电话，或将该号码存入通讯录。",
  th: "นี่ไม่ใช่ข้อความหลอกลวง {req}ฝากให้เราโทรถามข่าวคุณ เราเพิ่งโทรหาคุณ เราจะโทรอีกครั้งเวลา {time} กรุณาสังเกตสายจาก {num} หรือบันทึกเบอร์นี้ไว้ในรายชื่อผู้ติดต่อ",
  vi: "Đây không phải lừa đảo. {req} nhờ chúng tôi gọi hỏi thăm bạn — chúng tôi vừa gọi. Chúng tôi sẽ gọi lại lúc {time}. Vui lòng chú ý cuộc gọi từ {num} hoặc lưu số này vào danh bạ.",
  de: "Dies ist kein Betrug. {req} hat uns gebeten, anzurufen und zu hören, wie es dir geht — wir haben es gerade versucht. Wir versuchen es um {time} erneut. Achte bitte auf einen Anruf von {num} oder speichere die Nummer in deinen Kontakten.",
  ko: "사기 문자가 아닙니다. {req}님이 안부 전화를 부탁하셔서 방금 전화드렸습니다. {time}에 다시 전화드리겠습니다. {num}에서 오는 전화를 확인해 주시거나 이 번호를 연락처에 저장해 주세요.",
  fr: "Ceci n'est pas une arnaque. {req} nous a demandé d'appeler pour prendre de tes nouvelles — nous venons d'essayer. Nous réessaierons à {time}. Guette un appel du {num}, ou enregistre ce numéro dans tes contacts.",
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
    const templates = a.checkIn ? SMS_CHECKIN_TEMPLATES : SMS_TEMPLATES;
    const body = (templates[a.language ?? "en"] ?? templates.en)
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
