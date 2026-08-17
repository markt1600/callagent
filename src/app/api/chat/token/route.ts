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
