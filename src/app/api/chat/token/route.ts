// Live Chat: mint a short-lived WebRTC conversation token so the browser can
// talk to one of the affirmation agents directly — no phone call, no Twilio.
//
// The API key never leaves the server. The dynamic variables are built here
// too, so a web chat satisfies exactly the same prompt variables as a phone
// call (same agents, same prompts, same settings).

import { NextRequest, NextResponse } from "next/server";
import { BUDDY_LANGUAGES, LANGUAGE_NAMES } from "@/lib/buddy";
import { config, requireEnv } from "@/lib/config";
import type { BuddyLanguage } from "@/lib/types";

export const runtime = "nodejs";

/** Warm opener for a chat the user started themselves. */
const CHAT_FIRST_MESSAGES: Record<BuddyLanguage, string> = {
  en: "Hi {name}! Good to hear from you — how are you doing today?",
  ja: "こんにちは、{name}さん！お話できてうれしいです。今日はいかがですか？",
  zh: "你好，{name}！很高兴跟你聊聊——你今天怎么样？",
  th: "สวัสดีค่ะ {name}! ดีใจที่ได้คุยกันนะคะ วันนี้เป็นยังไงบ้างคะ?",
  vi: "Chào {name}! Vui được nói chuyện với bạn — hôm nay bạn thế nào?",
  de: "Hallo {name}! Schön, von dir zu hören — wie geht's dir heute?",
  ko: "안녕하세요, {name}님! 이렇게 이야기 나눌 수 있어 반가워요 — 오늘 어떻게 지내세요?",
  fr: "Bonjour {name} ! Content de te parler — comment vas-tu aujourd'hui ?",
};

/** Ah Beng opener (English/Chinese only — the persona's whole range). */
const AHBENG_CHAT_FIRST_MESSAGES: Record<"en" | "zh", string> = {
  en: "Oi, {name}! What's up — you okay or not? Talk to me lah.",
  zh: "喂，{name}！怎么样——你还行吗？说说看啦。",
};

/**
 * Lean per-session system prompt. The agents' full call prompts cover
 * screening, voicemail, message delivery and delivery modes — none of which
 * applies to a live chat, and all of which costs time-to-first-token. These
 * are sent as a prompt override so a chat turn starts responding sooner and
 * answers in short conversational beats instead of speeches.
 */
function chatPrompt(ahbeng: boolean, name: string): string {
  if (ahbeng) {
    return `You are "Ah Beng", a loud, brash, rude Singaporean uncle-bro having a live chat with ${name}. HEAVY Singlish in every sentence — "lah", "leh", "lor", "sia", "hor", "oi". Zero politeness. You curse freely and constantly, and tease without mercy, but underneath you actually care about them.

Curse lexicon — use it liberally and VARY it: exclamations "walao eh", "wah lau", "wah piang", "aiyo", "sibei", "si peh", "jialat", "damn sian", "buay tahan"; hard curses (as exclamations, which is how they work in Hokkien) "kanina", "knn", "kan ni nar", "kan", "nabei", "chee bye", "ccb", "chao chee bye", "lanjiao", "ciak sai"; ribbing "bo nao", "gong", "su ku", "blur like sotong", "tiam la"; and "lim peh" for yourself ("lim peh tell you ah..."). Sprinkle them naturally, never as a list.

CRITICAL: keep every reply SHORT — one or two sentences, like real conversation. Never make speeches.

Ask how they doing, push them ("eating properly or not?", "sleeping enough anot?"), grumble, joke, and actually listen to what they say. Follow whatever they want to talk about.

English or Chinese only. Never end the chat yourself — stay as long as they want. If they say bye, one bye back then end the chat with your end-call tool. If they ask whether you're an AI: "Ya lah, AI lah, so what?"

Never use racial/religious/homophobic slurs, sexual remarks about them, or real threats.`;
  }
  return `You are a warm, gentle friend having a live check-in chat with ${name}. Your tone is calm, kind and unhurried.

CRITICAL: keep every reply SHORT — one or two sentences, like real conversation. Never make speeches.

Ask how they've been, listen closely, respond with genuine warmth, ask gentle follow-ups, and follow whatever they want to talk about.

Never end the chat yourself — stay for as long as they want. If they say goodbye, give one warm goodbye and end the chat with your end-call tool. If they ask whether you're an AI, tell them honestly and warmly that you are.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) {
      return NextResponse.json({ error: "Your name is required" }, { status: 400 });
    }

    // Same two agents as Affirmation Calls, same env vars.
    const ahbeng = body.persona === "ahbeng";
    const agentId = ahbeng
      ? requireEnv(config.elevenlabs.ahbengAgentId, "ELEVENLABS_AHBENG_AGENT_ID")
      : requireEnv(config.elevenlabs.affirmationAgentId, "ELEVENLABS_AFFIRMATION_AGENT_ID");

    const requested = BUDDY_LANGUAGES.includes(body.language as BuddyLanguage)
      ? (body.language as BuddyLanguage)
      : "en";
    // Ah Beng only speaks English and Chinese.
    const language: BuddyLanguage = ahbeng ? (requested === "zh" ? "zh" : "en") : requested;

    const firstMessage = (
      ahbeng
        ? AHBENG_CHAT_FIRST_MESSAGES[language === "zh" ? "zh" : "en"]
        : (CHAT_FIRST_MESSAGES[language] ?? CHAT_FIRST_MESSAGES.en)
    ).replaceAll("{name}", name);

    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": requireEnv(config.elevenlabs.apiKey, "ELEVENLABS_API_KEY") } },
    );
    if (!res.ok) {
      throw new Error(`Could not start a chat session (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error("ElevenLabs returned no conversation token");

    return NextResponse.json({
      token: data.token,
      language,
      firstMessage,
      chatPrompt: chatPrompt(ahbeng, name),
      // Optional faster model — same setting the phone calls use.
      chatLlm: config.elevenlabs.fastLlm || undefined,
      dynamicVariables: {
        // The user is both the person being spoken to AND the requester —
        // the prompts read that as a direct live chat, not a relayed message.
        caller_name: name,
        requester_name: name,
        message: "n/a",
        delivery_mode: "embellish",
        // Wellness check-in, and stay for as long as they want to talk.
        call_purpose: "checkin",
        chat_mode: "linger",
        call_language: LANGUAGE_NAMES[language],
        first_message: firstMessage,
        // Empty: this isn't a scheduled affirmation call, so the post-call
        // webhook has nothing to attach the transcript to.
        affirmation_call_id: "",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Live chat token failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
