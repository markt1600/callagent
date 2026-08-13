"use client";

// Admin page: PIN-gated list of all reservations with one-tap delete.
// The PIN is verified server-side on every delete (x-admin-pin header).

import { useCallback, useEffect, useState } from "react";
import type { LibraryEntry, ReservationRequest } from "@/lib/types";

interface LibraryStats {
  count: number;
  totalHits: number;
  reuseRate: number;
  entries: LibraryEntry[];
}

export default function AdminPage() {
  const [pin, setPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [reservations, setReservations] = useState<ReservationRequest[]>([]);
  const [library, setLibrary] = useState<LibraryStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setPin(sessionStorage.getItem("adminPin"));
  }, []);

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

  useEffect(() => {
    if (pin) refresh();
  }, [pin, refresh]);

  function unlock() {
    if (!pinInput.trim()) return;
    sessionStorage.setItem("adminPin", pinInput.trim());
    setPin(pinInput.trim());
    setPinInput("");
    setError(null);
  }

  function lock() {
    sessionStorage.removeItem("adminPin");
    setPin(null);
    setReservations([]);
  }

  async function reverify(id: string) {
    if (!pin) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/reservations/${id}/reanalyze`, {
        method: "POST",
        headers: { "x-admin-pin": pin },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `Re-verify failed (${res.status})`);
        if (res.status === 401) lock();
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!pin) return;
    if (!window.confirm("Delete this reservation and its call history?")) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/reservations/${id}`, {
        method: "DELETE",
        headers: { "x-admin-pin": pin },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `Delete failed (${res.status})`);
        if (res.status === 401) lock();
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Admin</h1>
      <p className="sub">
        <a className="admin-link" href="/">
          ← Back to reservations
        </a>
      </p>

      {!pin ? (
        <div className="panel unlock-panel">
          <h2>Enter PIN</h2>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="Admin PIN"
          />
          <button onClick={unlock}>Unlock</button>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <h2 style={{ margin: 0 }}>Reservations ({reservations.length})</h2>
            <a className="admin-link" onClick={lock}>
              Lock
            </a>
          </div>
          {error && <p className="error">{error}</p>}
          {reservations.length === 0 && <p className="sub">No reservations.</p>}
          {reservations.map((r) => (
            <div
              key={r.id}
              className={`res-item ${r.outcome ? (r.outcome.success ? "won" : "lost") : r.status === "failed" ? "lost" : ""}`}
              style={{ cursor: "default" }}
            >
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <div>
                  <strong>{r.restaurantName}</strong>{" "}
                  <span className={`badge ${r.status}`}>{r.status.replace("_", " ")}</span>
                  <div className="meta">
                    {r.partySize} pax · {r.date} {r.time} · {r.phoneNumber}
                    {r.callerName ? ` · ${r.callerName}` : ""}
                  </div>
                </div>
                <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
                  <button
                    className="delete-btn"
                    title="Re-verify outcome from transcript"
                    disabled={busyId === r.id}
                    onClick={() => reverify(r.id)}
                    style={{ fontSize: "1.05rem" }}
                  >
                    {busyId === r.id ? "…" : "↻"}
                  </button>
                  <button
                    className="delete-btn"
                    title="Delete reservation"
                    disabled={busyId === r.id}
                    onClick={() => remove(r.id)}
                    style={{ fontSize: "1.2rem", color: "var(--err)" }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pin && library && (
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
          <p className="sub" style={{ margin: "0.5rem 0 0.75rem" }}>
            Grows with every call — common phrases are synthesized once, ever.
          </p>
          {library.entries.slice(0, 15).map((e) => (
            <div key={e.key} className="res-item" style={{ cursor: "default" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <span style={{ fontSize: "0.88rem" }}>{e.text}</span>
                <span className="badge" style={{ flexShrink: 0 }}>
                  {e.language} · {e.hits}×
                </span>
              </div>
            </div>
          ))}
          {library.entries.length > 15 && (
            <p className="sub" style={{ margin: 0 }}>
              …and {library.entries.length - 15} more.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
