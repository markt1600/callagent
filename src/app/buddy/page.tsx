"use client";

// Buddy Call: schedule a friendly check-in call to your own phone — a
// built-in excuse to step out of a date or meeting.

import { useCallback, useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import PhoneInput from "../components/PhoneInput";
import {
  destinationTimeLabel,
  formatInDestination,
  isoToDestinationWallClock,
} from "@/lib/phone";
import type { BuddyCall, Friend, UserProfile } from "@/lib/types";

interface MeResponse {
  user: UserProfile | null;
  isAdmin: boolean;
}

const EMPTY = {
  name: "",
  phoneNumber: "",
  language: "en",
  callAt: "",
  scenario: "",
  ecName: "",
  ecPhone: "",
  ecEmail: "",
  ecCodeword: "",
  ecLanguage: "",
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

export default function BuddyPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [calls, setCalls] = useState<BuddyCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);

  /** Fill the emergency-contact fields from a saved friend. */
  function applyFriendAsEc(id: string) {
    const f = friends.find((x) => x.id === id);
    if (!f) return;
    setForm((prev) => ({
      ...prev,
      ecName: f.name,
      ecPhone: f.phoneNumber,
      ecLanguage: f.language ?? prev.ecLanguage,
    }));
  }

  /** Load a pending call into the form for editing. */
  function startEdit(b: BuddyCall) {
    setEditingId(b.id);
    setForm({
      name: b.name,
      phoneNumber: b.phoneNumber,
      language: b.language ?? "en",
      callAt: isoToDestinationWallClock(b.callAt, b.phoneNumber),
      scenario: b.scenario ?? "",
      ecName: b.emergencyContact?.name ?? "",
      ecPhone: b.emergencyContact?.phone ?? "",
      ecEmail: b.emergencyContact?.email ?? "",
      ecCodeword: b.emergencyContact?.codeword ?? "",
      ecLanguage: b.emergencyContact?.language ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((f) => ({ ...EMPTY, name: f.name, phoneNumber: f.phoneNumber }));
  }

  const refresh = useCallback(async () => {
    try {
      const data = await fetch("/api/buddy").then((r) => r.json());
      setCalls(data.buddyCalls ?? []);
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
      .then((data: MeResponse & { user: UserProfile | null }) => {
        setMe(data);
        if (data.user) {
          const u = data.user;
          setForm((f) => ({
            ...f,
            name: f.name || (u.bookingName ?? u.name ?? "").split(/\s+/)[0] || "",
            phoneNumber: f.phoneNumber || u.contactPhone || "",
            language: u.buddyLanguage || f.language,
            ecName: f.ecName || u.emergencyContact?.name || "",
            ecPhone: f.ecPhone || u.emergencyContact?.phone || "",
            ecEmail: f.ecEmail || u.emergencyContact?.email || "",
            ecCodeword: f.ecCodeword || u.emergencyContact?.codeword || "",
            ecLanguage: f.ecLanguage || u.emergencyContact?.language || "",
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
      const res = await fetch(editingId ? `/api/buddy/${editingId}` : "/api/buddy", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phoneNumber: form.phoneNumber,
          language: form.language,
          // Sent as naive wall-clock — the server interprets it in the
          // destination country's timezone (keyed to the number's prefix).
          callAt: form.callAt,
          scenario: form.scenario || undefined,
          emergencyContact: form.ecName.trim()
            ? {
                name: form.ecName,
                phone: form.ecPhone || undefined,
                email: form.ecEmail || undefined,
                codeword: form.ecCodeword || undefined,
                language: form.ecLanguage || undefined,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setEditingId(null);
      setForm((f) => ({ ...f, callAt: "", scenario: "" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/buddy/${id}`, { method: "POST" });
    await refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this bail out call?")) return;
    await fetch(`/api/buddy/${id}`, { method: "DELETE" });
    await refresh();
  }

  /** Card tint: green = went ahead clean, orange = extension requested, red = emergency/failed. */
  function cardClass(b: BuddyCall): string {
    if (b.emergencyTriggeredAt || b.status === "failed") return "lost";
    if (b.rescheduledFor) return "extended";
    if (b.status === "completed") return "won";
    return "";
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        Bail Out <em>Call</em>
      </h1>
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a className="active">Bail Out Call</a>
        <a href="/affirm">Affirmation Call</a>
        <a href="/chat">Live Chat</a>
        <a href="/account">Account</a>
      </nav>
      <p className="sub">
        Your buddy M calls you at the time you pick — a friendly check-in with a built-in
        exit. Start describing a situation and M plays along until you hang up, or slip a
        codeword into the conversation to get a call-back in 30 or 60 minutes.
      </p>

      <div className="panel">
        <h2>{editingId ? "Edit bail out call" : "Schedule a bail out call"}</h2>
        {editingId && (
          <p className="sub" style={{ marginTop: 0 }}>
            Editing the pending call — save below, or{" "}
            <a className="admin-link" onClick={cancelEdit} style={{ cursor: "pointer" }}>
              cancel editing
            </a>
            .
          </p>
        )}
        <label>Your first name (what M calls you)</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Mark"
        />
        <label>Your phone number</label>
        <PhoneInput
          value={form.phoneNumber}
          onChange={(v) => setForm({ ...form, phoneNumber: v })}
        />
        <label>Call language (M switches if you answer in another one)</label>
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
        <label>
          When to call —{" "}
          {form.phoneNumber.startsWith("+")
            ? destinationTimeLabel(form.phoneNumber)
            : "local time of the number's country"}
        </label>
        <input
          type="datetime-local"
          value={form.callAt}
          onChange={(e) => setForm({ ...form, callAt: e.target.value })}
        />
        {form.phoneNumber.startsWith("+") && (
          <p className="sub" style={{ margin: "0.3rem 0 0" }}>
            Keyed to the number&apos;s country code: +65 → Singapore time, +81 → Japan time.
          </p>
        )}
        <label>The setting (optional — helps M sound right)</label>
        <textarea
          value={form.scenario}
          onChange={(e) => setForm({ ...form, scenario: e.target.value })}
          placeholder="e.g. first date at a wine bar; quarterly review with my manager"
        />

        <details style={{ marginTop: "0.9rem" }}>
          <summary className="sub" style={{ cursor: "pointer", marginBottom: 0 }}>
            Emergency contact (optional)
          </summary>
          <p className="sub" style={{ margin: "0.6rem 0 0" }}>
            A real-safety escape hatch. If you say the emergency codeword, M asks you to say
            it once more to confirm, acknowledges, hangs up — then calls your emergency
            contact (or emails them if no phone is given), identifying itself as an AI agent
            and telling them this could be a real emergency.
            {me?.user ? " Saved to your account for future bail out calls." : ""}
          </p>
          {friends.length > 0 && (
            <>
              <label>Choose from your friends (fills the details below)</label>
              <select value="" onChange={(e) => applyFriendAsEc(e.target.value)}>
                <option value="">— Pick a friend —</option>
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.phoneNumber})
                  </option>
                ))}
              </select>
            </>
          )}
          <label>Contact name</label>
          <input
            value={form.ecName}
            onChange={(e) => setForm({ ...form, ecName: e.target.value })}
            placeholder="Sarah Tan"
          />
          <label>Contact phone</label>
          <PhoneInput
            value={form.ecPhone}
            onChange={(v) => setForm({ ...form, ecPhone: v })}
            placeholder="98765432"
          />
          <label>Contact email</label>
          <input
            type="email"
            value={form.ecEmail}
            onChange={(e) => setForm({ ...form, ecEmail: e.target.value })}
            placeholder="sarah@example.com"
          />
          <label>Contact&apos;s language (for the emergency call/email)</label>
          <select
            value={form.ecLanguage}
            onChange={(e) => setForm({ ...form, ecLanguage: e.target.value })}
          >
            <option value="">Same as the call</option>
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label>Emergency codeword (leave blank to auto-generate)</label>
          <input
            value={form.ecCodeword}
            onChange={(e) => setForm({ ...form, ecCodeword: e.target.value })}
            placeholder="e.g. redwood"
          />
        </details>

        <button onClick={create} disabled={busy}>
          {busy ? "Saving…" : editingId ? "💾 Save changes" : "🤙 Schedule bail out call"}
        </button>
        <p className="sub" style={{ margin: "0.5rem 0 0" }}>
          Costs the same credits as any call to that destination. If the call doesn&apos;t
          connect, M retries every 30 seconds, up to 5 tries.
        </p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        <h2>Your bail out calls</h2>
        {calls.length === 0 && <p className="sub">None scheduled yet.</p>}
        {calls.map((b) => (
          <div key={b.id} className={`res-item ${cardClass(b)}`} style={{ cursor: "default" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div>
                <strong>{formatInDestination(b.callAt, b.phoneNumber)}</strong>{" "}
                <span className={`badge ${b.status}`}>{b.status}</span>
                <div className="meta">
                  {b.phoneNumber} · for {b.name}
                  {b.attempts > 0 ? ` · ${b.attempts} attempt${b.attempts > 1 ? "s" : ""}` : ""}
                </div>
              </div>
              <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
                {b.status === "scheduled" && (
                  <button
                    className="delete-btn"
                    title="Edit this call"
                    onClick={() => startEdit(b)}
                    style={{ fontSize: "1rem" }}
                  >
                    ✎
                  </button>
                )}
                {(b.status === "scheduled" || b.status === "calling") && (
                  <button
                    className="secondary"
                    style={{ marginTop: 0, minHeight: 0, padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                    onClick={() => cancel(b.id)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="delete-btn"
                  title="Delete"
                  onClick={() => remove(b.id)}
                  style={{ fontSize: "1.2rem", color: "var(--err)" }}
                >
                  ✕
                </button>
              </span>
            </div>
            {(b.status === "scheduled" || b.status === "calling") && (
              <div className="meta" style={{ marginTop: "0.4rem" }}>
                Say <strong>{b.codeword30}</strong> in conversation → call-back in 30 min ·{" "}
                <strong>{b.codeword60}</strong> → 60 min. Or just start describing an
                emergency — M plays along until you hang up.
              </div>
            )}
            {b.emergencyContact && (b.status === "scheduled" || b.status === "calling") && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                🚨 Real emergency: say <strong>{b.emergencyContact.codeword}</strong>, then
                confirm it when M asks → M acknowledges, hangs up, and contacts{" "}
                {b.emergencyContact.name}.
              </div>
            )}
            {b.emergencyStatus && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                🚨 Emergency contact {b.emergencyContact?.name}:{" "}
                {b.emergencyStatus === "notified"
                  ? "notified"
                  : b.emergencyStatus === "calling"
                    ? "being called…"
                    : "could not be reached"}
              </div>
            )}
            {b.rescheduledFor && b.status === "scheduled" && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                Codeword heard — calling back at{" "}
                {formatInDestination(b.rescheduledFor, b.phoneNumber)}.
              </div>
            )}
            {b.summary && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                {b.summary}
              </div>
            )}
            {b.error && <p className="error">{b.error}</p>}
          </div>
        ))}
      </div>

      <BottomNav active="buddy" isAdmin={me?.isAdmin} />
    </main>
  );
}
