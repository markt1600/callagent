"use client";

import { useCallback, useEffect, useState } from "react";
import type { CallSession, ReservationRequest } from "@/lib/types";

interface LibraryStats {
  count: number;
  totalHits: number;
  reuseRate: number;
}

const EMPTY_FORM = {
  restaurantName: "",
  phoneNumber: "",
  partySize: 2,
  date: "",
  time: "19:00",
  language: "ja",
  callerName: "",
  specialRequests: "",
};

export default function Dashboard() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [reservations, setReservations] = useState<ReservationRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [library, setLibrary] = useState<LibraryStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operatorText, setOperatorText] = useState("");

  const selected = reservations.find((r) => r.id === selectedId) ?? null;
  const activeCall =
    calls.find((c) => c.status === "in_progress") ?? calls[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/reservations");
      const data = await res.json();
      setReservations(data.reservations ?? []);
      const lib = await fetch("/api/library").then((r) => r.json());
      setLibrary(lib);
    } catch {
      /* transient */
    }
  }, []);

  const refreshCalls = useCallback(async () => {
    if (!selectedId) {
      setCalls([]);
      return;
    }
    try {
      const res = await fetch(`/api/calls?reservationId=${selectedId}`);
      const data = await res.json();
      const list: CallSession[] = data.calls ?? [];
      // Pull the freshest copy (with lazy translations) of the newest call.
      if (list[0]) {
        const detail = await fetch(`/api/calls/${list[0].id}`).then((r) => r.json());
        if (detail.call) list[0] = detail.call;
      }
      setCalls(list);
    } catch {
      /* transient */
    }
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    refreshCalls();
    const t = setInterval(refreshCalls, 3000);
    return () => clearInterval(t);
  }, [refreshCalls]);

  async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    return data as Record<string, unknown>;
  }

  async function createReservation() {
    setError(null);
    setBusy("create");
    try {
      const data = await api("/api/reservations", form);
      const reservation = data.reservation as ReservationRequest;
      setSelectedId(reservation.id);
      await refresh();
      // Kick off phrase-pack generation immediately.
      setBusy("prepare");
      await api(`/api/reservations/${reservation.id}/prepare`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function prepare(id: string) {
    setError(null);
    setBusy("prepare");
    try {
      await api(`/api/reservations/${id}/prepare`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function placeCall(id: string, mode: "agent" | "ivr") {
    setError(null);
    setBusy(`call-${mode}`);
    try {
      await api(`/api/reservations/${id}/call`, { mode });
      await refresh();
      await refreshCalls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendOperator(hangupAfter = false) {
    if (!activeCall || !operatorText.trim()) return;
    setBusy("operator");
    try {
      await api(`/api/calls/${activeCall.id}/operator`, {
        text: operatorText.trim(),
        hangupAfter,
      });
      setOperatorText("");
      await refreshCalls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function operatorAction(action: "take_over" | "resume_auto") {
    if (!activeCall) return;
    try {
      await api(`/api/calls/${activeCall.id}/operator`, { action });
      await refreshCalls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <h1>CallAgent</h1>
      <p className="sub">
        AI phone agent for reservations in Japan — pre-generated phrase audio, cached-first
        playback, live translation relay fallback.
      </p>

      <div className="grid">
        <div>
          <div className="panel">
            <h2>New reservation request</h2>
            <label>Restaurant name</label>
            <input
              value={form.restaurantName}
              onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
              placeholder="鮨 さいとう"
            />
            <label>Phone number (E.164)</label>
            <input
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              placeholder="+81312345678"
            />
            <div className="row">
              <div style={{ flex: 1 }}>
                <label>Party size</label>
                <input
                  type="number"
                  min={1}
                  value={form.partySize}
                  onChange={(e) => setForm({ ...form, partySize: Number(e.target.value) })}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label>Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Time</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </div>
            </div>
            <label>Call language</label>
            <select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
            >
              <option value="ja">Japanese</option>
              <option value="en">English</option>
            </select>
            <label>Booking name</label>
            <input
              value={form.callerName}
              onChange={(e) => setForm({ ...form, callerName: e.target.value })}
              placeholder="Tanaka"
            />
            <label>Special requests (optional)</label>
            <textarea
              value={form.specialRequests}
              onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
              placeholder="Counter seats if possible; one guest is vegetarian"
            />
            <button onClick={createReservation} disabled={busy !== null}>
              {busy === "create"
                ? "Creating…"
                : busy === "prepare"
                  ? "Generating phrases + audio…"
                  : "Create & prepare phrases"}
            </button>
            {error && <p className="error">{error}</p>}
          </div>

          {library && (
            <div className="panel">
              <h2>Phrase library</h2>
              <div className="row" style={{ gap: "1.5rem" }}>
                <div>
                  <div className="stat">{library.count}</div>
                  <div className="stat-label">cached phrases</div>
                </div>
                <div>
                  <div className="stat">{library.totalHits}</div>
                  <div className="stat-label">total uses</div>
                </div>
                <div>
                  <div className="stat">{Math.round(library.reuseRate * 100)}%</div>
                  <div className="stat-label">reuse rate</div>
                </div>
              </div>
              <p className="sub" style={{ margin: "0.5rem 0 0" }}>
                Grows with every call — common phrases are synthesized once, ever.
              </p>
            </div>
          )}

          <div className="panel">
            <h2>Reservations</h2>
            {reservations.length === 0 && <p className="sub">None yet.</p>}
            {reservations.map((r) => (
              <div
                key={r.id}
                className={`res-item ${selectedId === r.id ? "selected" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{r.restaurantName}</strong>
                  <span className={`badge ${r.status}`}>{r.status.replace("_", " ")}</span>
                </div>
                <div className="meta">
                  {r.partySize}名 · {r.date} {r.time} · {r.phoneNumber}
                </div>
                {r.outcome && (
                  <div className="meta">
                    <span className={`badge ${r.outcome.success ? "ok" : "failed"}`}>
                      {r.outcome.success ? "confirmed" : "not confirmed"}
                    </span>{" "}
                    {r.outcome.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          {selected ? (
            <>
              <div className="panel">
                <h2>
                  {selected.restaurantName}{" "}
                  <span className={`badge ${selected.status}`}>
                    {selected.status.replace("_", " ")}
                  </span>
                </h2>
                <div className="row">
                  <button
                    className="secondary"
                    onClick={() => prepare(selected.id)}
                    disabled={busy !== null || selected.status === "generating_phrases"}
                  >
                    {selected.phrasePack ? "Regenerate phrases" : "Prepare phrases"}
                  </button>
                  <button
                    onClick={() => placeCall(selected.id, "agent")}
                    disabled={busy !== null}
                    title="ElevenLabs Conversational AI handles the realtime loop"
                  >
                    {busy === "call-agent" ? "Dialing…" : "📞 Call (Agent mode)"}
                  </button>
                  <button
                    onClick={() => placeCall(selected.id, "ivr")}
                    disabled={busy !== null || !selected.phrasePack}
                    title="Self-hosted loop with cached audio"
                  >
                    {busy === "call-ivr" ? "Dialing…" : "📞 Call (Cached IVR mode)"}
                  </button>
                </div>
                {selected.error && <p className="error">{selected.error}</p>}
                {selected.phrasePack?.cacheStats && (
                  <p className="sub" style={{ margin: "0.6rem 0 0" }}>
                    Phrase pack: {selected.phrasePack.phrases.length} phrases —{" "}
                    {selected.phrasePack.cacheStats.libraryHits} reused from library,{" "}
                    {selected.phrasePack.cacheStats.newlySynthesized} newly synthesized.
                  </p>
                )}
              </div>

              {activeCall && (
                <div className="panel">
                  <h2>
                    Call ({activeCall.mode}){" "}
                    <span className={`badge ${activeCall.status}`}>
                      {activeCall.status.replace("_", " ")}
                    </span>
                    {activeCall.relayActive && (
                      <span className="badge calling" style={{ marginLeft: 8 }}>
                        operator relay active
                      </span>
                    )}
                  </h2>
                  <div className="transcript">
                    {activeCall.turns.length === 0 && (
                      <p className="sub">No transcript yet…</p>
                    )}
                    {activeCall.turns.map((t, i) => (
                      <div key={i} className={`turn ${t.speaker}`}>
                        <div className="who">
                          {t.speaker}
                          {t.source ? ` · ${t.source}` : ""}
                          {t.intent ? ` · ${t.intent}` : ""}
                        </div>
                        <div>{t.text}</div>
                        {t.english && t.english !== t.text && (
                          <div className="en">{t.english}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  {activeCall.status === "in_progress" && activeCall.mode === "ivr" && (
                    <div style={{ marginTop: "0.9rem" }}>
                      <label>Operator relay — type in English, spoken in Japanese</label>
                      <textarea
                        value={operatorText}
                        onChange={(e) => setOperatorText(e.target.value)}
                        placeholder="e.g. Could we do 7:30 instead? / Thank you, goodbye."
                      />
                      <div className="row">
                        <button onClick={() => sendOperator(false)} disabled={busy !== null}>
                          Send (translated)
                        </button>
                        <button
                          className="danger"
                          onClick={() => sendOperator(true)}
                          disabled={busy !== null}
                        >
                          Send & hang up
                        </button>
                        {activeCall.relayActive ? (
                          <button className="secondary" onClick={() => operatorAction("resume_auto")}>
                            Resume automation
                          </button>
                        ) : (
                          <button className="secondary" onClick={() => operatorAction("take_over")}>
                            Take over call
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selected.phrasePack && (
                <div className="panel">
                  <h2>Phrase pack ({selected.phrasePack.language})</h2>
                  <p className="sub">{selected.phrasePack.scenario}</p>
                  <ul className="phrase-list">
                    {selected.phrasePack.phrases.map((p) => (
                      <li key={p.id}>
                        <span className="badge">{p.category}</span> {p.text}
                        <div className="en">{p.english}</div>
                        {p.audioUrl && <audio controls preload="none" src={p.audioUrl} />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="panel">
              <h2>Select a reservation</h2>
              <p className="sub">
                Create a reservation request on the left. The system will script the call with
                Claude, pre-render every phrase to audio via ElevenLabs (reusing the persistent
                phrase library), and then you can place the call.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
