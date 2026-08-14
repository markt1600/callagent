"use client";

// Affirmation Call: a warm, soothing call that delivers a personal message
// to someone, on the requester's behalf, at a destination-local time.
// Messages are either typed (spoken by the AI voice) or recorded in the
// requester's own voice (converted to WAV client-side, previewed before
// scheduling, and replayed verbatim on the call).

import { useCallback, useEffect, useRef, useState } from "react";
import BottomNav from "../components/BottomNav";
import {
  destinationTimeLabel,
  formatInDestination,
  isoToDestinationWallClock,
} from "@/lib/phone";
import type { AffirmationCall, Friend, UserProfile } from "@/lib/types";

const MAX_RECORD_SECONDS = 180;

/** Encode mono Float32 samples as a 16-bit PCM WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataLen = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(ab);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Decode any browser recording (webm/mp4) and re-encode as 16 kHz mono WAV. */
async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  } finally {
    ctx.close();
  }
}

interface MeResponse {
  user: UserProfile | null;
  isAdmin: boolean;
}

const EMPTY = {
  recipientName: "",
  phoneNumber: "",
  callAt: "",
  message: "",
  requesterName: "",
  delivery: "literal",
  language: "en",
  messageMode: "typed" as "typed" | "recorded",
  recurrence: "",
  callTiming: "now" as "now" | "scheduled",
};

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

export default function AffirmPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [calls, setCalls] = useState<AffirmationCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Voice recording state
  const [recState, setRecState] = useState<"idle" | "recording" | "recorded">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [recPreviewUrl, setRecPreviewUrl] = useState<string | null>(null);
  const recBlob = useRef<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);

  /** Apply a saved friend's details to the form. */
  function applyFriend(id: string) {
    const f = friends.find((x) => x.id === id);
    if (!f) return;
    setForm((prev) => ({
      ...prev,
      recipientName: f.name,
      phoneNumber: f.phoneNumber,
      language: f.language ?? prev.language,
    }));
  }

  /** Load a pending call into the form for editing. */
  function startEdit(a: AffirmationCall) {
    setEditingId(a.id);
    setForm({
      recipientName: a.recipientName,
      phoneNumber: a.phoneNumber,
      callAt: isoToDestinationWallClock(a.callAt, a.phoneNumber),
      message: a.message,
      requesterName: a.requesterName,
      delivery: a.literal ? "literal" : "embellish",
      language: a.language ?? "en",
      messageMode: a.recordingUrl ? "recorded" : "typed",
      recurrence: a.recurrence ?? "",
      callTiming: "scheduled",
    });
    if (a.recordingUrl) {
      // Existing recording stays unless re-recorded.
      recBlob.current = null;
      setRecPreviewUrl(a.recordingUrl);
      setRecState("recorded");
    } else {
      discardRecording();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((f) => ({ ...EMPTY, requesterName: f.requesterName }));
    discardRecording();
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        recBlob.current = blob;
        setRecPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setRecState("recorded");
      };
      recorder.current = mr;
      mr.start();
      setRecState("recording");
      setRecSeconds(0);
      recTimer.current = setInterval(() => {
        setRecSeconds((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access was denied — allow it to record a message.");
    }
  }

  function stopRecording() {
    if (recTimer.current) clearInterval(recTimer.current);
    recTimer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function discardRecording() {
    recBlob.current = null;
    if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
    setRecPreviewUrl(null);
    setRecState("idle");
    setRecSeconds(0);
  }

  const refresh = useCallback(async () => {
    try {
      const data = await fetch("/api/affirm").then((r) => r.json());
      setCalls(data.affirmationCalls ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: MeResponse) => {
        setMe(data);
        if (data.user) {
          const u = data.user;
          setForm((f) => ({
            ...f,
            requesterName: f.requesterName || u.bookingName || u.name || "",
          }));
          fetch("/api/me/friends")
            .then((r) => r.json())
            .then((d) => setFriends(d.friends ?? []))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      // Recorded mode: convert the browser recording to WAV and upload it
      // first — the call replays this exact audio. When editing, a call
      // that already has a recording keeps it unless re-recorded.
      let recordingUrl: string | null | undefined;
      if (form.messageMode === "recorded") {
        if (recBlob.current) {
          const wav = await blobToWav(recBlob.current);
          const up = await fetch("/api/affirm/recording", {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wav,
          });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData.error || `Recording upload failed (${up.status})`);
          recordingUrl = upData.url;
        } else if (!editingId) {
          throw new Error("Record your message first (and preview it).");
        }
      } else if (editingId) {
        recordingUrl = null; // switched to typed — clear the recording
      }

      const res = await fetch(editingId ? `/api/affirm/${editingId}` : "/api/affirm", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: form.recipientName,
          phoneNumber: form.phoneNumber,
          callNow: !editingId && form.callTiming === "now",
          callAt: form.callTiming === "scheduled" ? form.callAt : undefined,
          message: form.messageMode === "typed" ? form.message : "",
          requesterName: form.requesterName,
          literal: form.delivery === "literal",
          language: form.language,
          recurrence: form.recurrence || undefined,
          recordingUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setEditingId(null);
      setForm((f) => ({ ...f, recipientName: "", phoneNumber: "", callAt: "", message: "" }));
      discardRecording();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/affirm/${id}`, { method: "POST" });
    await refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this affirmation call?")) return;
    await fetch(`/api/affirm/${id}`, { method: "DELETE" });
    await refresh();
  }

  function cardClass(a: AffirmationCall): string {
    if (a.status === "completed") return "won";
    if (a.status === "failed") return "lost";
    return "";
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        Affirmation <em>Call</em>
      </h1>
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a href="/buddy">Bail Out Call</a>
        <a className="active">Affirmation Call</a>
        <a href="/account">Account</a>
      </nav>
      <p className="sub">
        A warm, soothing call that delivers your message to someone you care about — word
        for word, or gently embellished. If they don&apos;t pick up, it retries an hour
        later, again two hours after that (never past 10 PM their time), then the next day
        at the original time.
      </p>

      <div className="panel">
        <h2>{editingId ? "Edit affirmation call" : "Schedule an affirmation call"}</h2>
        {editingId && (
          <p className="sub" style={{ marginTop: 0 }}>
            Editing the pending call — save below, or{" "}
            <a className="admin-link" onClick={cancelEdit} style={{ cursor: "pointer" }}>
              cancel editing
            </a>
            .
          </p>
        )}
        {friends.length > 0 && (
          <>
            <label>Choose from your friends (fills the details below)</label>
            <select value="" onChange={(e) => applyFriend(e.target.value)}>
              <option value="">— Pick a friend —</option>
              {friends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.phoneNumber})
                </option>
              ))}
            </select>
          </>
        )}
        <label>Who to call (their name)</label>
        <input
          value={form.recipientName}
          onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
          placeholder="Emi"
        />
        <label>Their phone number (E.164)</label>
        <input
          value={form.phoneNumber}
          onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
          placeholder="+6591234567"
        />
        <label>When to call</label>
        <div className="row">
          <select
            value={form.callTiming}
            onChange={(e) =>
              setForm({ ...form, callTiming: e.target.value as "now" | "scheduled" })
            }
            style={{ flex: 1 }}
          >
            <option value="now">Call now</option>
            <option value="scheduled">Schedule the call</option>
          </select>
          {form.callTiming === "scheduled" && (
            <input
              type="datetime-local"
              value={form.callAt}
              onChange={(e) => setForm({ ...form, callAt: e.target.value })}
              style={{ flex: 1.4 }}
            />
          )}
        </div>
        {form.callTiming === "scheduled" && (
          <p className="sub" style={{ margin: "0.3rem 0 0" }}>
            Time is{" "}
            {form.phoneNumber.startsWith("+")
              ? destinationTimeLabel(form.phoneNumber)
              : "the local time of the number's country"}{" "}
            (keyed to the country code).
          </p>
        )}
        <label>Repeat</label>
        <select
          value={form.recurrence}
          onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
        >
          <option value="">One-time</option>
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
          <option value="annual">Annually</option>
        </select>
        <label>From (the requester — that&apos;s you)</label>
        <input
          value={form.requesterName}
          onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
          placeholder="Mark"
        />
        <label>Agent language (when it calls them)</label>
        <select
          value={form.language}
          onChange={(e) => setForm({ ...form, language: e.target.value })}
        >
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label>Message</label>
        <select
          value={form.messageMode}
          onChange={(e) =>
            setForm({ ...form, messageMode: e.target.value as "typed" | "recorded" })
          }
        >
          <option value="typed">Type it — the AI voice delivers it</option>
          <option value="recorded">Record it in my own voice — replayed on the call</option>
        </select>
        {form.messageMode === "typed" ? (
          <>
            <label>The message to deliver</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="e.g. I'm so proud of how you handled this week. Dinner's on me on Friday."
            />
            <label>Delivery</label>
            <select
              value={form.delivery}
              onChange={(e) => setForm({ ...form, delivery: e.target.value })}
            >
              <option value="literal">Word-for-word (literal)</option>
              <option value="embellish">Approximate — the AI may warmly embellish</option>
            </select>
          </>
        ) : (
          <div style={{ marginTop: "0.6rem" }}>
            {recState === "idle" && (
              <button type="button" className="secondary" onClick={startRecording}>
                🎙 Start recording
              </button>
            )}
            {recState === "recording" && (
              <div className="row" style={{ alignItems: "center" }}>
                <button type="button" className="danger" onClick={stopRecording}>
                  ■ Stop
                </button>
                <span className="sub" style={{ margin: 0 }}>
                  Recording… {recSeconds}s (max {MAX_RECORD_SECONDS / 60} min)
                </span>
              </div>
            )}
            {recState === "recorded" && recPreviewUrl && (
              <>
                <label>Preview your message before scheduling</label>
                <audio controls src={recPreviewUrl} style={{ width: "100%" }} />
                <div className="row">
                  <button type="button" className="secondary" onClick={discardRecording}>
                    ↺ Re-record
                  </button>
                </div>
              </>
            )}
            <p className="sub" style={{ margin: "0.5rem 0 0" }}>
              The call plays this exact recording after a short spoken intro naming{" "}
              {form.requesterName || "the requester"}. Voicemail gets the message too.
            </p>
          </div>
        )}
        <button
          onClick={create}
          disabled={busy || (form.messageMode === "recorded" && recState !== "recorded")}
        >
          {busy ? "Saving…" : editingId ? "💾 Save changes" : "💌 Schedule affirmation call"}
        </button>
        <p className="sub" style={{ margin: "0.5rem 0 0" }}>
          Costs the same credits as any call to that destination.
        </p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        <h2>Your affirmation calls</h2>
        {calls.length === 0 && <p className="sub">None scheduled yet.</p>}
        {calls.map((a) => (
          <div key={a.id} className={`res-item ${cardClass(a)}`} style={{ cursor: "default" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div>
                <strong>{formatInDestination(a.callAt, a.phoneNumber)}</strong>{" "}
                <span className={`badge ${a.status}`}>{a.status}</span>
                <div className="meta">
                  To {a.recipientName} · {a.phoneNumber} · from {a.requesterName} ·{" "}
                  {a.recordingUrl ? "your voice" : a.literal ? "word-for-word" : "embellished"}
                  {a.recurrence
                    ? ` · repeats ${a.recurrence === "annual" ? "annually" : a.recurrence}`
                    : ""}
                  {a.attempts > 0
                    ? ` · ${a.attempts} attempt${a.attempts > 1 ? "s" : ""}${a.cycle > 1 ? " (day 2)" : ""}`
                    : ""}
                </div>
              </div>
              <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
                {a.status === "scheduled" && (
                  <button
                    className="delete-btn"
                    title="Edit this call"
                    onClick={() => startEdit(a)}
                    style={{ fontSize: "1rem" }}
                  >
                    ✎
                  </button>
                )}
                {(a.status === "scheduled" || a.status === "calling") && (
                  <button
                    className="secondary"
                    style={{ marginTop: 0, minHeight: 0, padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                    onClick={() => cancel(a.id)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="delete-btn"
                  title="Delete"
                  onClick={() => remove(a.id)}
                  style={{ fontSize: "1.2rem", color: "var(--err)" }}
                >
                  ✕
                </button>
              </span>
            </div>
            {a.recordingUrl ? (
              <div className="meta" style={{ marginTop: "0.4rem" }}>
                🎙 Recorded voice message
                <audio
                  controls
                  preload="none"
                  src={a.recordingUrl}
                  style={{ width: "100%", marginTop: "0.3rem" }}
                />
              </div>
            ) : (
              <div className="meta" style={{ marginTop: "0.4rem" }}>
                “{a.message.length > 140 ? `${a.message.slice(0, 140)}…` : a.message}”
              </div>
            )}
            {a.summary && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                {a.summary}
              </div>
            )}
            {a.error && <p className="error">{a.error}</p>}
          </div>
        ))}
      </div>

      <BottomNav active="affirm" isAdmin={me?.isAdmin} />
    </main>
  );
}
