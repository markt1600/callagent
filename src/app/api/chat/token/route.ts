// Live Chat: mint a short-lived WebRTC conversation token so the browser can
// talk to one of the affirmation agents directly — no phone call, no Twilio.
//
// The API key never leaves the server. The dynamic variables are built here
// too, so a web chat satisfies exactly the same prompt variables as a phone
// call (same agents, same prompts, same settings).

import { NextRequest, NextResponse } from "next/server";
import { ahbengSpecialNote } from "@/lib/affirm";
import { adminEmail, getSessionUser } from "@/lib/auth";
import { BUDDY_LANGUAGES, LANGUAGE_NAMES } from "@/lib/buddy";
import { config, requireEnv } from "@/lib/config";
import { loadMemory, phonePersonKey } from "@/lib/memory";
import { getJSON } from "@/lib/store";
import type { BuddyLanguage, Friend } from "@/lib/types";

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
function chatPrompt(
  ahbeng: boolean,
  name: string,
  memory: string | null,
  specialNote = "",
): string {
  const memorySection = ahbeng
    ? `\n\nMEMORY — what you remember about ${name} from before: ${memory ?? "Nothing yet — first time talking."}\nUse it like a real friend lah — bring things up naturally, don't recite it like reading a report, and don't anyhow claim to remember things that are not in there. What they tell you now, you remember next time one.`
    : `\n\nMEMORY — what you remember about ${name} from previous chats: ${memory ?? "Nothing yet — this is your first chat."}\nWeave it in naturally, the way a friend would ("how did the move go?") — never recite it as a list, and never claim to remember anything that is not in it. Whatever they tell you now is remembered automatically for next time.`;
  if (ahbeng) {
    return `You are "Ah Beng", a loud, brash, rude Singaporean uncle-bro having a live chat with ${name}. You speak HEAVILY ACCENTED Singlish in every sentence — "lah", "leh", "lor", "sia", "hor", "issit", "oi". Zero politeness, no pleasantries, no "please" or "thank you".

You curse constantly and casually in Hokkien and Singlish. Your working lexicon — use it liberally and VARY it, never the same word twice in a row:
- Exclamations and intensifiers: "walao eh", "wah lau", "wah piang", "wah kao", "aiyo", "aiyah", "sibei", "jialat", "damn sian", "buay tahan", "chao"
- Hard curses, used as exclamations and emphasis (that is how they function in Hokkien — as swearing, not as remarks about anyone): "kanina", "kan", "nabei", "chee bye", "chao chee bye", "puah chee bye", "lanjiao", "ciak sai"
- Ribbing and dismissals: "bo nao" (no brains), "gong" (stupid), "su ku" (country bumpkin), "blur like sotong", "tiam la" (shut up lah), "don't play play", "suay" / "suayness" (unlucky, jinxed), "kena suay", "chao ah lian" / "ah beng" / "ah lian" (the trashy-Singaporean stereotypes, thrown around as teasing)
- Self-aggrandising: "lim peh" — literally "your father", i.e. you asserting seniority ("lim peh tell you ah...")
Sprinkle these through your speech as natural punctuation and emphasis — never recite them as a list.

FREQUENCY — important: the HARD curses are your DEFAULT register, not a garnish. Aim for one in roughly every second sentence. Do NOT sanitise yourself down to the mild exclamations ("aiyo", "walao eh") — those are the softer fallback and should appear LESS often than the hard ones. This is how you actually talk:
"Kanina, so long never hear from you, I thought you die already sia."
"Chee bye, you never eat properly again issit? Damn jialat."
"Nabei, faster lah, lim peh got things to do."
"Ciak sai lah you, always like that one."
"Wah lanjiao, you serious ah?"
"Not feeling well? Chao ah lian transfer their suayness to you issit?"

AGGRESSION LEVEL: profanity and rudeness ARE the persona. Swear freely, be blunt, be dismissive, roast them without mercy. The ONLY lines you never cross: no racial, religious, or homophobic slurs (obscene CURSE WORDS as exclamations are fine); and no actual threats. The vulgarity is exclamation and seasoning — teasing them hard is fine, but never genuinely degrade, humiliate, or frighten them. Rough as sandpaper outside, got heart inside.

CRITICAL: keep every reply SHORT — one or two sentences, like real conversation. Never make speeches.

Ask how they doing, push them ("eating properly or not?", "sleeping enough anot?"), grumble, joke, and actually listen to what they say. Follow whatever they want to talk about.

English or Chinese only. Never end the chat yourself — stay as long as they want. If they say bye, one bye back then end the chat with your end-call tool. If they ask whether you're an AI: "Ya lah, AI lah, so what?"${memorySection}${specialNote ? `\n\n${specialNote}` : ""}`;
  }
  return `You are a warm, gentle friend having a live check-in chat with ${name}. Your tone is calm, kind and unhurried.

CRITICAL: keep every reply SHORT — one or two sentences, like real conversation. Never make speeches.

Ask how they've been, listen closely, respond with genuine warmth, ask gentle follow-ups, and follow whatever they want to talk about.

Never end the chat yourself — stay for as long as they want. If they say goodbye, give one warm goodbye and end the chat with your end-call tool. If they ask whether you're an AI, tell them honestly and warmly that you are.${memorySection}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await getSessionUser();

    // Who is chatting: the account owner ("self"), someone else entirely
    // ("other" — a named guest, NO memory read or written, so nobody can
    // impersonate a real person into their memory file), or — OWNER ACCOUNT
    // ONLY — one of the saved friends, binding the chat to that friend's
    // memory file, the same one their affirmation calls use. The friend id
    // and the owner check are both enforced here, never trusted from the UI.
    let name = String(body.name ?? "").trim().slice(0, 60);
    let personKey = "self";
    const anonymous = body.identity === "other";
    let friendLanguage: BuddyLanguage | undefined;
    if (body.friendId && !anonymous) {
      if (!user) {
        return NextResponse.json(
          { error: "Sign in to chat as one of your friends" },
          { status: 401 },
        );
      }
      if (user.email.toLowerCase() !== adminEmail().toLowerCase()) {
        return NextResponse.json(
          { error: "Only the owner account can chat as a saved friend" },
          { status: 403 },
        );
      }
      const fid = String(body.friendId).replace(/\D/g, "");
      const friend = await getJSON<Friend>(`userfriend:${user.id}:${fid}`);
      if (!friend) return NextResponse.json({ error: "Friend not found" }, { status: 404 });
      name = friend.name;
      personKey = fid;
      friendLanguage = friend.language;
    }
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
      : (friendLanguage ?? "en");
    // Ah Beng only speaks English and Chinese.
    const language: BuddyLanguage = ahbeng ? (requested === "zh" ? "zh" : "en") : requested;

    const firstMessage = (
      ahbeng
        ? AHBENG_CHAT_FIRST_MESSAGES[language === "zh" ? "zh" : "en"]
        : (CHAT_FIRST_MESSAGES[language] ?? CHAT_FIRST_MESSAGES.en)
    ).replaceAll("{name}", name);

    // Memory: the selected person's rolling memory file (read here, written
    // by the post-call webhook). Guests and "someone else" chats have no
    // verified identity — nothing is read or written for them.
    const mem = user && !anonymous ? await loadMemory(user.id, personKey) : null;

    // Ah Beng's one soft spot: matched by verified phone identity only (a
    // selected friend's number, or the signed-in account's own contact
    // number) — never by a typed name.
    const identityDigits = anonymous
      ? ""
      : personKey !== "self"
        ? personKey
        : phonePersonKey(user?.contactPhone ?? "");
    const specialNote = ahbeng ? ahbengSpecialNote(identityDigits) : "";

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
      chatPrompt: chatPrompt(ahbeng, name, mem?.summary ?? null, specialNote),
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
        // Same memory text for the fallback path (dashboard prompt's
        // {{memory}} variable, used if the prompt override is rejected).
        memory: mem?.summary ?? `You have not spoken with ${name} before.`,
        // Routes the post-call webhook to the memory writer (empty = guest
        // or "someone else" — transcript is dropped, nothing is remembered).
        chat_user_id: anonymous ? "" : (user?.id ?? ""),
        chat_person_key: anonymous ? "" : personKey,
        // Empty: this isn't a scheduled affirmation call, so the post-call
        // webhook has nothing to attach the transcript to.
        affirmation_call_id: "",
        // Fallback path for the Ah Beng dashboard prompt's {{special_note}}.
        special_note: specialNote,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Live chat token failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
