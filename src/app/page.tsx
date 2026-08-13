"use client";

import { useCallback, useEffect, useState } from "react";
import { shiftHHMM } from "@/lib/timeUtils";
import type { CallSession, ReservationRequest } from "@/lib/types";

const EMPTY_FORM = {
  restaurantName: "",
  phoneNumber: "",
  partySize: 2,
  date: "",
  time: "19:00",
  timeWindowStart: "",
  timeWindowEnd: "",
  language: "en",
  callerName: "",
  contactPhone: "",
  notifyEmail: "",
  specialRequests: "",
  // Additional options (expandable)
  seating: "",
  minimumSpend: "",
  smoking: "",
  timeLimit: "",
  privateRoom: false,
  quietTable: false,
  kidsCount: 0,
  kidsSeating: false,
  occasion: "",
  occasionName: "",
  birthdayCake: false,
  allergies: "",
  accessibility: false,
  askCorkage: false,
  callTiming: "now" as "now" | "scheduled",
  callAt: "",
};

export default function Dashboard() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [reservations, setReservations] = useState<ReservationRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallSession[]>([]);
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
      const {
        callTiming,
        callAt,
        seating,
        minimumSpend,
        smoking,
        timeLimit,
        privateRoom,
        quietTable,
        kidsCount,
        kidsSeating,
        occasion,
        occasionName,
        birthdayCake,
        allergies,
        accessibility,
        askCorkage,
        ...rest
      } = form;
      const body: Record<string, unknown> = { ...rest };
      if (callTiming === "scheduled" && callAt) {
        body.callAt = new Date(callAt).toISOString();
      }
      body.preferences = {
        seating: seating || undefined,
        minimumSpendOk: minimumSpend === "" ? undefined : minimumSpend === "yes",
        smoking: smoking || undefined,
        timeLimitOk: timeLimit === "" ? undefined : timeLimit === "yes",
        privateRoom,
        quietTable,
        kidsCount,
        kidsSeating,
        occasion: occasion || undefined,
        occasionName: occasionName || undefined,
        birthdayCake,
        allergies: allergies || undefined,
        accessibility,
        askCorkage,
      };
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

  async function cancelCall(id: string) {
    if (
      !window.confirm(
        "Call the restaurant to cancel this reservation? The agent will phone them now.",
      )
    )
      return;
    setError(null);
    setBusy("cancel-call");
    try {
      await api(`/api/reservations/${id}/cancel-call`);
      await refresh();
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
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1
        onClick={() => {
          setSelectedId(null);
          setSelectedCallId(null);
        }}
        style={{ cursor: "pointer" }}
        title="Back to overview"
      >
        Agentic <em>Reservations</em>
      </h1>
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
              <div style={{ flex: "1 1 90px", minWidth: 90 }}>
                <label>Party size</label>
                <input
                  type="number"
                  min={1}
                  value={form.partySize}
                  onChange={(e) => setForm({ ...form, partySize: Number(e.target.value) })}
                />
              </div>
              <div style={{ flex: "2 1 150px", minWidth: 150 }}>
                <label>Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div style={{ flex: "1 1 130px", minWidth: 130 }}>
                <label>Preferred time</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </div>
            </div>
            <label>
              Acceptable seating range (optional) — if the preferred time is full, the agent
              accepts the closest slot in this range. Leave blank to accept only the exact
              preferred time.
            </label>
            <div className="row">
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 0, minHeight: 0, padding: "0.45rem 0.9rem", fontSize: "0.8rem" }}
                onClick={() =>
                  setForm({
                    ...form,
                    timeWindowStart: shiftHHMM(form.time, -60),
                    timeWindowEnd: shiftHHMM(form.time, 60),
                  })
                }
              >
                ± 1 hour
              </button>
              <input
                type="time"
                value={form.timeWindowStart}
                onChange={(e) => setForm({ ...form, timeWindowStart: e.target.value })}
                style={{ flex: "1 1 120px", minWidth: 120 }}
              />
              <span className="sub" style={{ margin: 0 }}>
                to
              </span>
              <input
                type="time"
                value={form.timeWindowEnd}
                onChange={(e) => setForm({ ...form, timeWindowEnd: e.target.value })}
                style={{ flex: "1 1 120px", minWidth: 120 }}
              />
              {(form.timeWindowStart || form.timeWindowEnd) && (
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: 0, minHeight: 0, padding: "0.45rem 0.9rem", fontSize: "0.8rem" }}
                  onClick={() => setForm({ ...form, timeWindowStart: "", timeWindowEnd: "" })}
                >
                  Clear
                </button>
              )}
            </div>
            {!form.timeWindowStart && !form.timeWindowEnd && (
              <p className="sub" style={{ margin: "0.3rem 0 0" }}>
                No range set — only the exact preferred time will be accepted.
              </p>
            )}
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
              placeholder="Anything else the agent should mention"
            />

            <details style={{ marginTop: "0.9rem" }}>
              <summary className="sub" style={{ cursor: "pointer", marginBottom: 0 }}>
                Additional options (occasion, seating, kids…)
              </summary>

              <label style={{ marginTop: "0.9rem" }}>
                Raised by the agent during the call
              </label>
              <div className="row" style={{ gap: "1rem" }}>
                <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                  <input type="checkbox" checked={form.privateRoom}
                    onChange={(e) => setForm({ ...form, privateRoom: e.target.checked })} />
                  Private room required
                </label>
                <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                  <input type="checkbox" checked={form.quietTable}
                    onChange={(e) => setForm({ ...form, quietTable: e.target.checked })} />
                  Quieter table preferred
                </label>
              </div>
              <div className="row" style={{ gap: "1rem", marginTop: "0.4rem" }}>
                <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                  <input type="checkbox" checked={form.accessibility}
                    onChange={(e) => setForm({ ...form, accessibility: e.target.checked })} />
                  Wheelchair/stroller access
                </label>
                <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                  <input type="checkbox" checked={form.askCorkage}
                    onChange={(e) => setForm({ ...form, askCorkage: e.target.checked })} />
                  Ask corkage policy
                </label>
              </div>

              <div className="row">
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label>Children in party</label>
                  <input type="number" min={0} value={form.kidsCount}
                    onChange={(e) => setForm({ ...form, kidsCount: Number(e.target.value) })} />
                </div>
                {form.kidsCount > 0 && (
                  <label style={{ margin: "1.4rem 0 0", textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                    <input type="checkbox" checked={form.kidsSeating}
                      onChange={(e) => setForm({ ...form, kidsSeating: e.target.checked })} />
                    Kids seating needed
                  </label>
                )}
              </div>

              <label>Special occasion</label>
              <select value={form.occasion}
                onChange={(e) => setForm({ ...form, occasion: e.target.value })}>
                <option value="">None</option>
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="business">Business dinner</option>
                <option value="date">Date night</option>
              </select>
              {form.occasion && (
                <>
                  <label>Who is celebrating? (optional)</label>
                  <input value={form.occasionName}
                    onChange={(e) => setForm({ ...form, occasionName: e.target.value })}
                    placeholder="e.g. Emi" />
                </>
              )}
              {form.occasion === "birthday" && (
                <label style={{ margin: "0.6rem 0 0", textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
                  <input type="checkbox" checked={form.birthdayCake}
                    onChange={(e) => setForm({ ...form, birthdayCake: e.target.checked })} />
                  Ask if they can prepare a birthday cake (extra charge OK; fine if unavailable)
                </label>
              )}

              <label>Allergies / dietary restrictions (always stated)</label>
              <input value={form.allergies}
                onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                placeholder="e.g. shellfish allergy; one vegetarian" />

              <label style={{ marginTop: "1.1rem" }}>
                Only if it comes up in the conversation
              </label>
              <div className="row">
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label>Seating preference</label>
                  <select value={form.seating}
                    onChange={(e) => setForm({ ...form, seating: e.target.value })}>
                    <option value="">No preference</option>
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                    <option value="counter">Counter</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label>Smoking section</label>
                  <select value={form.smoking}
                    onChange={(e) => setForm({ ...form, smoking: e.target.value })}>
                    <option value="">No preference</option>
                    <option value="non_smoking">Non-smoking</option>
                    <option value="smoking">Smoking</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label>Minimum spend</label>
                  <select value={form.minimumSpend}
                    onChange={(e) => setForm({ ...form, minimumSpend: e.target.value })}>
                    <option value="">Not specified</option>
                    <option value="yes">OK if required</option>
                    <option value="no">Not OK — decline</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label>Seating time limit</label>
                  <select value={form.timeLimit}
                    onChange={(e) => setForm({ ...form, timeLimit: e.target.value })}>
                    <option value="">Not specified</option>
                    <option value="yes">OK if required</option>
                    <option value="no">Not OK — decline</option>
                  </select>
                </div>
              </div>
            </details>

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

          <div className="panel">
            <h2>Reservations</h2>
            {reservations.length === 0 && <p className="sub">None yet.</p>}
            {reservations.map((r) => (
              <div
                key={r.id}
                className={`res-item ${selectedId === r.id ? "selected" : ""} ${
                  r.status === "cancelled"
                    ? ""
                    : r.outcome
                      ? r.outcome.success
                        ? "won"
                        : "lost"
                      : r.status === "failed"
                        ? "lost"
                        : ""
                }`}
                onClick={() => {
                  // Tapping the selected card again deselects it.
                  setSelectedId(selectedId === r.id ? null : r.id);
                  setSelectedCallId(null);
                }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{r.restaurantName}</strong>
                  <span className={`badge ${r.status}`}>{r.status.replace("_", " ")}</span>
                </div>
                <div className="meta">
                  {r.partySize} pax · {r.date} {r.time}
                  {r.outcome?.confirmedTime && r.outcome.confirmedTime !== r.time
                    ? ` (booked ${r.outcome.confirmedTime})`
                    : ""}{" "}
                  · {r.phoneNumber}
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
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <h2>
                    {selected.restaurantName}{" "}
                    <span className={`badge ${selected.status}`}>
                      {selected.status.replace("_", " ")}
                    </span>
                  </h2>
                  <button
                    className="delete-btn"
                    title="Close details"
                    onClick={() => {
                      setSelectedId(null);
                      setSelectedCallId(null);
                    }}
                    style={{ fontSize: "1.1rem", color: "var(--muted)", flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
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
                  {selected.outcome?.success && selected.status === "completed" && (
                    <button
                      className="danger"
                      onClick={() => cancelCall(selected.id)}
                      disabled={busy !== null}
                      title="Calls the restaurant to cancel this reservation"
                    >
                      {busy === "cancel-call" ? "Dialing…" : "📞 Call to cancel"}
                    </button>
                  )}
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
                Fill in the reservation form to get started — the AI agent calls the
                restaurant immediately (or at your scheduled time). When the call finishes,
                open the reservation to see its call log, transcript, and outcome; if you
                provided an email, a confirmation with the transcript is sent there too.
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="sub" style={{ textAlign: "center", marginTop: "2.5rem", marginBottom: 0 }}>
        <a className="admin-link" href="/admin">
          Admin
        </a>
      </p>
    </main>
  );
}
