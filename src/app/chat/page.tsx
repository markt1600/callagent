"use client";

// Live Chat: talk to one of the affirmation agents in the browser over
// WebRTC — no phone call, no Twilio. Uses the same two agents as Affirmation
// Calls with the wellness check-in and stay-as-long-as-you-like settings.

import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation, type Language } from "@elevenlabs/client";
import BottomNav from "../components/BottomNav";
import type { UserProfile } from "@/lib/types";

interface MeResponse {
  user: UserProfile | null;
  isAdmin: boolean;
}

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese (Mandarin)" },
  { value: "ja", label: "Japanese" },
  { value: "th", label: "Thai" },
  { value: "vi", label: "Vietnamese" },
  { value: "de", label: "German" },
  { value: "ko", label: "Korean" },
  { value: "fr", label: "French" },
];

type Turn = { role: "you" | "agent"; text: string };

export default function ChatPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState({
    name: "",
    persona: "standard",
    language: "en",
    mode: "ptt" as "ptt" | "handsfree" | "text",
  });
  const [phase, setPhase] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const convo = useRef<Conversation | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);
  const activityPing = useRef<ReturnType<typeof setInterval> | null>(null);

  // Push-to-talk: the mic stays closed between turns. Holding opens it and
  // pings "user is active" so the agent won't talk over you; releasing closes
  // it again, which gives the agent clean digital silence to end the turn on.
  const startTalking = useCallback(() => {
    if (!convo.current || phase !== "live") return;
    setTalking(true);
    convo.current.setMicMuted(false);
    convo.current.sendUserActivity();
    activityPing.current ??= setInterval(() => convo.current?.sendUserActivity(), 1500);
  }, [phase]);

  const stopTalking = useCallback(() => {
    if (activityPing.current) {
      clearInterval(activityPing.current);
      activityPing.current = null;
    }
    if (!convo.current) return;
    setTalking(false);
    convo.current.setMicMuted(true);
  }, []);

  // Spacebar as the push-to-talk key.
  useEffect(() => {
    if (phase !== "live" || form.mode !== "ptt") return;
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      startTalking();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      stopTalking();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, form.mode, startTalking, stopTalking]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: MeResponse) => {
        setMe(data);
        if (data.user) {
          const u = data.user;
          setForm((f) => ({
            ...f,
            name: f.name || (u.bookingName ?? u.name ?? "").split(/\s+/)[0] || "",
            language: u.buddyLanguage || f.language,
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Keep the newest turn in view.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Never leave a live session running behind a closed page.
  useEffect(() => {
    return () => {
      if (activityPing.current) clearInterval(activityPing.current);
      convo.current?.endSession().catch(() => {});
      convo.current = null;
    };
  }, []);

  const begin = useCallback(async () => {
    setError(null);
    if (!form.name.trim()) {
      setError("Enter your name first.");
      return;
    }
    setPhase("connecting");
    setTurns([]);
    try {
      const res = await fetch("/api/chat/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          persona: form.persona,
          language: form.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Could not start the chat (${res.status})`);

      const textOnly = form.mode === "text";
      const session = (overrides: Record<string, unknown>) => ({
        conversationToken: data.token as string,
        connectionType: "webrtc" as const,
        dynamicVariables: data.dynamicVariables as Record<string, string>,
        overrides,
        textOnly,
        onStatusChange: ({ status }: { status: string }) => {
          if (status === "connected") {
            setPhase("live");
            // Push-to-talk starts with the mic closed.
            if (form.mode === "ptt") {
              convo.current?.setMicMuted(true);
              setTalking(false);
            }
          }
          if (status === "disconnected") setPhase((p) => (p === "idle" ? p : "ended"));
        },
        onModeChange: ({ mode }: { mode: string }) => setSpeaking(mode === "speaking"),
        onMessage: ({ message, source }: { message: string; source: string }) => {
          if (!message?.trim()) return;
          setTurns((t) => [...t, { role: source === "user" ? "you" : "agent", text: message }]);
        },
        onError: (msg: string) => setError(msg),
      });

      const language = data.language as Language;
      try {
        // Lean chat prompt = far less to process before the first word.
        convo.current = await Conversation.startSession(
          session({
            agent: {
              language,
              prompt: {
                prompt: data.chatPrompt as string,
                ...(data.chatLlm ? { llm: data.chatLlm as string } : {}),
              },
              firstMessage: data.firstMessage as string,
            },
          }),
        );
      } catch (overrideErr) {
        // The agent may not permit prompt/first-message overrides — fall back
        // to its dashboard prompt rather than failing the chat.
        console.warn("Prompt override rejected, retrying without it:", overrideErr);
        convo.current = await Conversation.startSession(session({ agent: { language } }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The most common first-run failure by far.
      setError(
        /permission|denied|NotAllowed/i.test(msg)
          ? "Microphone access was denied — allow it, or switch to text chat."
          : msg,
      );
      setPhase("idle");
    }
  }, [form]);

  async function end() {
    if (activityPing.current) {
      clearInterval(activityPing.current);
      activityPing.current = null;
    }
    await convo.current?.endSession().catch(() => {});
    convo.current = null;
    setPhase("ended");
    setSpeaking(false);
    setTalking(false);
  }

  function toggleMute() {
    const next = !muted;
    convo.current?.setMicMuted(next);
    setMuted(next);
  }

  function sendTyped() {
    const text = typed.trim();
    if (!text || !convo.current) return;
    convo.current.sendUserMessage(text);
    setTyped("");
  }

  const personaLabel = form.persona === "ahbeng" ? "Ah Beng 🕶️" : "your concierge";

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        Live <em>Chat</em>
      </h1>
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a href="/buddy">Bail Out Call</a>
        <a href="/affirm">Affirmation Call</a>
        <a className="active">Live Chat</a>
        <a href="/account">Account</a>
      </nav>
      <p className="sub">
        Talk to the same agents right here in your browser — no phone call. They check in
        on how you&apos;re doing and stay for as long as you want to talk.
      </p>

      {phase === "idle" || phase === "ended" ? (
        <div className="panel">
          <h2>{phase === "ended" ? "Start another chat" : "Start a chat"}</h2>
          <label>Your name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Mark"
          />
          <label>Who do you want to talk to?</label>
          <select
            value={form.persona}
            onChange={(e) => {
              const persona = e.target.value;
              setForm({
                ...form,
                persona,
                language:
                  persona === "ahbeng" && form.language !== "zh" && form.language !== "en"
                    ? "en"
                    : form.language,
              });
            }}
          >
            <option value="standard">Standard — warm and soothing</option>
            <option value="ahbeng">Ah Beng — male, heavy Singlish (English/Chinese only)</option>
          </select>
          <label>Language</label>
          <select
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          >
            {(form.persona === "ahbeng"
              ? LANGUAGE_OPTIONS.filter((o) => o.value === "en" || o.value === "zh")
              : LANGUAGE_OPTIONS
            ).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label>How do you want to chat?</label>
          <select
            value={form.mode}
            onChange={(e) =>
              setForm({ ...form, mode: e.target.value as "ptt" | "handsfree" | "text" })
            }
          >
            <option value="ptt">Push to talk — hold to speak, release to reply (fastest)</option>
            <option value="handsfree">Hands-free — just talk, it listens continuously</option>
            <option value="text">Text — type and read replies</option>
          </select>
          <button onClick={begin}>💬 Begin chat</button>
          <p className="sub" style={{ margin: "0.5rem 0 0" }}>
            Runs in your browser — no call is placed and no call credits are used.
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <h2 style={{ margin: 0 }}>
              {phase === "connecting" ? "Connecting…" : `Chatting with ${personaLabel}`}{" "}
              {phase === "live" && (
                <span className={`badge ${speaking ? "calling" : "ok"}`}>
                  {speaking ? "speaking" : "listening"}
                </span>
              )}
            </h2>
            <button
              className="delete-btn"
              title="End chat"
              onClick={end}
              style={{ fontSize: "1.15rem", color: "var(--muted)", flexShrink: 0 }}
            >
              ✕
            </button>
          </div>

          <div className="transcript" style={{ marginTop: "0.8rem" }}>
            {turns.length === 0 && (
              <p className="sub">
                {phase === "connecting"
                  ? "Setting up the connection…"
                  : form.mode === "ptt"
                    ? "Hold the button (or the spacebar) and say hello."
                    : form.mode === "handsfree"
                      ? "Say hello — they can hear you."
                      : "Type a message below to get started."}
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`turn ${t.role === "you" ? "restaurant" : "agent"}`}>
                <div className="who">{t.role === "you" ? "you" : "agent"}</div>
                <div>{t.text}</div>
              </div>
            ))}
            <div ref={transcriptEnd} />
          </div>

          {form.mode === "text" && phase === "live" && (
            <div className="row" style={{ marginTop: "0.8rem", flexWrap: "nowrap" }}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendTyped()}
                placeholder="Type a message…"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                onClick={sendTyped}
                style={{ marginTop: 0, flexShrink: 0 }}
                disabled={!typed.trim()}
              >
                Send
              </button>
            </div>
          )}

          {form.mode === "ptt" && phase === "live" && (
            <>
              <button
                type="button"
                className={talking ? "" : "secondary"}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  startTalking();
                }}
                onPointerUp={stopTalking}
                onPointerCancel={stopTalking}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  width: "100%",
                  marginTop: "0.9rem",
                  minHeight: 64,
                  fontSize: "0.95rem",
                  touchAction: "none",
                  userSelect: "none",
                }}
              >
                {talking ? "🎙 Listening — release to send" : "🎤 Hold to talk"}
              </button>
              <p className="sub" style={{ margin: "0.4rem 0 0", textAlign: "center" }}>
                Or hold the <strong>spacebar</strong>.
              </p>
            </>
          )}

          <div className="row">
            {form.mode === "handsfree" && phase === "live" && (
              <button className="secondary" onClick={toggleMute}>
                {muted ? "🔇 Unmute" : "🎙 Mute"}
              </button>
            )}
            <button className="danger" onClick={end}>
              End chat
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      <BottomNav active="chat" isAdmin={me?.isAdmin} />
    </main>
  );
}
