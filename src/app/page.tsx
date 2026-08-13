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
  language: "en",
  callerName: "",
  contactPhone: "",
  notifyEmail: "",
  specialRequests: "",
  callTiming: "now" as "now" | "scheduled",
  callAt: "",
};

export default function Dashboard() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [reservations, setReservations] = useState<ReservationRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [library, setLibrary] = useState<LibraryStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operatorText, setOperatorText] = useState("");

  const selected = reservations.find((r) => r.id === selectedId) ?? null;
  const activeCall =
    calls.find((c) => c.id === selectedCallId) ??
    calls.find((c) => c.status === "in_progress") ??
    calls[0] ??
    null;

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
      // Pull the freshest copy (with lazy translations) of the viewed call.
      const focusIdx = Math.max(
        0,
        list.findIndex((c) => c.id === selectedCallId),
      );
      if (list[focusIdx]) {
        const detail = await fetch(`/api/calls/${list[focusIdx].id}`).then((r) => r.json());
        if (detail.call) list[focusIdx] = detail.call;
      }
      setCalls(list);
    } catch {
      /* transient */
    }
  }, [selectedId, selectedCallId]);

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
      const { callTiming, callAt, ...rest } = form;
      const body: Record<string, unknown> = { ...rest };
      if (callTiming === "scheduled" && callAt) {
        body.callAt = new Date(callAt).toISOString();
      }
      const data = await api("/api/reservations", body);
      const reservation = data.reservation as ReservationRequest;
      setSelectedId(reservation.id);
      if (reservation.error) setError(reservation.error);
      await refresh();
      await refreshCalls();
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
        AI reservation agent for restaurants in Japan and Singapore — enter the details,
        and it calls the restaurant and books your table.
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
              <option value="en">English</option>
              <option value="ja">Japanese</option>
              <option value="zh">Mandarin</option>
            </select>
            {form.language === "en" && form.phoneNumber.startsWith("+65") && (
              <p className="sub" style={{ margin: "0.3rem 0 0" }}>
                Singapore number: a Mandarin fallback pack will be prepared automatically in
                case the restaurant answers in Mandarin.
              </p>
            )}
            <label>Booking name (first and last name)</label>
            <input
              value={form.callerName}
              onChange={(e) => setForm({ ...form, callerName: e.target.value })}
              placeholder="Taro Tanaka"
            />
            <label>Guest contact number (the number given to the restaurant)</label>
            <input
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              placeholder="+6591234567"
            />
            <label>Email confirmation to (optional)</label>
            <input
              type="email"
              value={form.notifyEmail}
              onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}
              placeholder="you@example.com"
            />
            <label>Special requests (optional)</label>
            <textarea
              value={form.specialRequests}
              onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
              placeholder="Counter seats if possible; one guest is vegetarian"
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
            <button onClick={createReservation} disabled={busy !== null}>
              {busy === "create"
                ? form.callTiming === "now"
                  ? "Placing call…"
                  : "Scheduling…"
                : form.callTiming === "now"
                  ? "📞 Make reservation call"
                  : "Schedule reservation call"}
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
                className={`res-item ${selectedId === r.id ? "selected" : ""} ${
                  r.outcome ? (r.outcome.success ? "won" : "lost") : r.status === "failed" ? "lost" : ""
                }`}
                onClick={() => {
                  setSelectedId(r.id);
                  setSelectedCallId(null);
                }}
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
                {selected.status === "scheduled" && selected.callAt && (
                  <p className="sub" style={{ margin: "0 0 0.5rem" }}>
                    {selected.attempts
                      ? `No answer on attempt ${selected.attempts} — retry scheduled for ${new Date(selected.callAt).toLocaleString()} (max 3 attempts, 12:00–19:00 local time)`
                      : `Call scheduled for ${new Date(selected.callAt).toLocaleString()}`}
                  </p>
                )}
                <div className="row">
                  <button
                    onClick={() => placeCall(selected.id, "agent")}
                    disabled={busy !== null || selected.status === "calling"}
                    title="Places the call now via the AI agent"
                  >
                    {busy === "call-agent"
                      ? "Dialing…"
                      : selected.status === "scheduled"
                        ? "📞 Call now instead"
                        : "📞 Call again"}
                  </button>
                </div>
                {selected.error && <p className="error">{selected.error}</p>}
                <details style={{ marginTop: "0.6rem" }}>
                  <summary className="sub" style={{ cursor: "pointer", marginBottom: 0 }}>
                    Advanced: cached IVR mode (pre-generated audio loop)
                  </summary>
                  <div className="row">
                    <button
                      className="secondary"
                      onClick={() => prepare(selected.id)}
                      disabled={busy !== null || selected.status === "generating_phrases"}
                    >
                      {selected.phrasePack ? "Regenerate phrases" : "Prepare phrases"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => placeCall(selected.id, "ivr")}
                      disabled={busy !== null || !selected.phrasePack}
                      title="Self-hosted loop with cached audio"
                    >
                      {busy === "call-ivr" ? "Dialing…" : "📞 Call (IVR mode)"}
                    </button>
                  </div>
                </details>
                {selected.phrasePack?.cacheStats && (
                  <p className="sub" style={{ margin: "0.6rem 0 0" }}>
                    Phrase pack: {selected.phrasePack.phrases.length} phrases —{" "}
                    {selected.phrasePack.cacheStats.libraryHits} reused from library,{" "}
                    {selected.phrasePack.cacheStats.newlySynthesized} newly synthesized.
                    {selected.altPhrasePack &&
                      ` Fallback pack (${selected.altPhrasePack.language}): ${selected.altPhrasePack.phrases.length} phrases ready.`}
                  </p>
                )}
              </div>

              {calls.length > 0 && (
                <div className="panel">
                  <h2>Call log ({calls.length} attempt{calls.length > 1 ? "s" : ""})</h2>
                  {calls.map((c, i) => (
                    <div
                      key={c.id}
                      className={`res-item ${activeCall?.id === c.id ? "selected" : ""}`}
                      onClick={() => setSelectedCallId(c.id)}
                    >
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span>
                          Attempt {calls.length - i} · {c.mode}
                        </span>
                        <span className={`badge ${c.status}`}>{c.status.replace("_", " ")}</span>
                      </div>
                      <div className="meta">
                        {new Date(c.startedAt).toLocaleString()}
                        {c.turns.length > 0 ? ` · ${c.turns.length} turns` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeCall && (
                <div className="panel">
                  <h2>
                    Transcript ({activeCall.mode}){" "}
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
                      <label>
                        {activeCall.activeLanguage === "ja" || (!activeCall.activeLanguage && selected.language === "ja")
                          ? "Operator relay — type in English, spoken in Japanese"
                          : activeCall.activeLanguage === "zh" || (!activeCall.activeLanguage && selected.language === "zh")
                            ? "Operator relay — type in English, spoken in Mandarin"
                            : "Operator relay — type your reply, spoken on the call"}
                      </label>
                      <textarea
                        value={operatorText}
                        onChange={(e) => setOperatorText(e.target.value)}
                        placeholder="e.g. Could we do 7:30 instead? / Thank you, goodbye."
                      />
                      <div className="row">
                        <button onClick={() => sendOperator(false)} disabled={busy !== null}>
                          {(activeCall.activeLanguage ?? selected.language) === "en"
                            ? "Send"
                            : "Send (translated)"}
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
                Create a reservation on the left — the AI agent calls the restaurant
                immediately (or at your scheduled time) and the transcript and outcome appear
                here when the call finishes.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
