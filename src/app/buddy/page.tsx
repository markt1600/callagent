"use client";

// Buddy Call: schedule a friendly check-in call to your own phone — a
// built-in excuse to step out of a date or meeting.

import { useCallback, useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import type { BuddyCall, UserProfile } from "@/lib/types";

interface MeResponse {
  user: UserProfile | null;
  isAdmin: boolean;
}

const EMPTY = {
  name: "",
  phoneNumber: "",
  callAt: "",
  scenario: "",
};

export default function BuddyPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [calls, setCalls] = useState<BuddyCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          }));
        }
      })
      .catch(() => {});
  }, []);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/buddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phoneNumber: form.phoneNumber,
          callAt: form.callAt ? new Date(form.callAt).toISOString() : "",
          scenario: form.scenario || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
    if (!window.confirm("Delete this buddy call?")) return;
    await fetch(`/api/buddy/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        Buddy <em>Call</em>
      </h1>
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a className="active">Buddy Call</a>
        <a href="/account">Account</a>
      </nav>
      <p className="sub">
        Your buddy M calls you at the time you pick — a friendly check-in with a built-in
        exit. Start describing a situation and M plays along until you hang up, or slip a
        codeword into the conversation to get a call-back in 30 or 60 minutes.
      </p>

      <div className="panel">
        <h2>Schedule a buddy call</h2>
        <label>Your first name (what M calls you)</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Mark"
        />
        <label>Your phone number (E.164)</label>
        <input
          value={form.phoneNumber}
          onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
          placeholder="+6591234567"
        />
        <label>When to call</label>
        <input
          type="datetime-local"
          value={form.callAt}
          onChange={(e) => setForm({ ...form, callAt: e.target.value })}
        />
        <label>The setting (optional — helps M sound right)</label>
        <textarea
          value={form.scenario}
          onChange={(e) => setForm({ ...form, scenario: e.target.value })}
          placeholder="e.g. first date at a wine bar; quarterly review with my manager"
        />
        <button onClick={create} disabled={busy}>
          {busy ? "Scheduling…" : "🤙 Schedule buddy call"}
        </button>
        <p className="sub" style={{ margin: "0.5rem 0 0" }}>
          Costs the same credits as any call to that destination. If the call doesn&apos;t
          connect, M retries every 30 seconds, up to 5 tries.
        </p>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        <h2>Your buddy calls</h2>
        {calls.length === 0 && <p className="sub">None scheduled yet.</p>}
        {calls.map((b) => (
          <div key={b.id} className="res-item" style={{ cursor: "default" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div>
                <strong>{new Date(b.callAt).toLocaleString()}</strong>{" "}
                <span className={`badge ${b.status}`}>{b.status}</span>
                <div className="meta">
                  {b.phoneNumber} · for {b.name}
                  {b.attempts > 0 ? ` · ${b.attempts} attempt${b.attempts > 1 ? "s" : ""}` : ""}
                </div>
              </div>
              <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
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
            {b.rescheduledFor && b.status === "scheduled" && (
              <div className="meta" style={{ marginTop: "0.3rem" }}>
                Codeword heard — calling back at {new Date(b.rescheduledFor).toLocaleTimeString()}.
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
