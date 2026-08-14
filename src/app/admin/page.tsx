"use client";

// Admin page: PIN-gated list of all reservations with one-tap delete.
// The PIN is verified server-side on every delete (x-admin-pin header).

import { useCallback, useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
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
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [costs, setCosts] = useState<Array<{ prefix: string; cost: number }>>([]);
  const [costsSaved, setCostsSaved] = useState(false);

  useEffect(() => {
    setPin(sessionStorage.getItem("adminPin"));
    // Admin is only offered to the owner account (server enforces it too).
    fetch("/api/me")
      .then((r) => r.json())
      .then((me) => setAccess(me.isAdmin ? "allowed" : "denied"))
      .catch(() => setAccess("allowed")); // fall through to the PIN, server decides
  }, []);

  const loadCosts = useCallback(async () => {
    const stored = sessionStorage.getItem("adminPin");
    if (!stored) return;
    try {
      const res = await fetch("/api/admin/credits", { headers: { "x-admin-pin": stored } });
      const data = await res.json();
      if (res.ok && data.costs) {
        setCosts(
          Object.entries(data.costs as Record<string, number>)
            .sort(([a], [b]) => (a === "default" ? 1 : b === "default" ? -1 : a.localeCompare(b)))
            .map(([prefix, cost]) => ({ prefix, cost })),
        );
      }
    } catch {
      /* transient */
    }
  }, []);

  async function saveCosts() {
    if (!pin) return;
    setError(null);
    setCostsSaved(false);
    const body = {
      costs: Object.fromEntries(costs.filter((c) => c.prefix.trim()).map((c) => [c.prefix.trim(), c.cost])),
    };
    const res = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: string }).error || `Save failed (${res.status})`);
      if (res.status === 401) lock();
      return;
    }
    setCostsSaved(true);
    loadCosts();
  }

  const refresh = useCallback(async () => {
    try {
      // The PIN header makes the list include ALL users' reservations.
      const stored = sessionStorage.getItem("adminPin");
      const res = await fetch("/api/reservations", {
        headers: stored ? { "x-admin-pin": stored } : undefined,
      });
      const data = await res.json();
      setReservations(data.reservations ?? []);
      const lib = await fetch("/api/library").then((r) => r.json());
      setLibrary(lib);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    if (pin) {
      refresh();
      loadCosts();
    }
  }, [pin, refresh, loadCosts]);

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
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        <em>Admin</em>
      </h1>
      <p className="sub">
        <a className="admin-link" href="/">
          ← Back to reservations
        </a>
      </p>

      {access === "denied" ? (
        <div className="panel">
          <h2>Owner only</h2>
          <p className="sub">
            Admin is restricted to the owner account. Sign in with the owner&apos;s Google
            account on the <a className="admin-link" href="/account">Account</a> page first.
          </p>
        </div>
      ) : access === "loading" ? (
        <div className="panel">
          <p className="sub">Checking access…</p>
        </div>
      ) : !pin ? (
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

      {access === "allowed" && pin && (
        <div className="panel">
          <h2>Call credit costs</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Credits charged per call by destination prefix. Every user starts with 100,000
            credits; each call attempt deducts its cost. <code>default</code> applies to
            any number without a matching prefix.
          </p>
          {costs.map((c, i) => (
            <div className="row" key={i} style={{ alignItems: "center" }}>
              <input
                value={c.prefix}
                disabled={c.prefix === "default"}
                onChange={(e) =>
                  setCosts(costs.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))
                }
                placeholder="+81"
                style={{ flex: "1 1 100px", minWidth: 100 }}
              />
              <input
                type="number"
                min={0}
                value={c.cost}
                onChange={(e) =>
                  setCosts(
                    costs.map((x, j) => (j === i ? { ...x, cost: Number(e.target.value) } : x)),
                  )
                }
                style={{ flex: "1 1 80px", minWidth: 80 }}
              />
              {c.prefix !== "default" && (
                <button
                  className="delete-btn"
                  title="Remove"
                  onClick={() => setCosts(costs.filter((_, j) => j !== i))}
                  style={{ fontSize: "1.1rem", color: "var(--err)" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button
              className="secondary"
              onClick={() => setCosts([...costs, { prefix: "", cost: 1 }])}
            >
              + Add prefix
            </button>
            <button onClick={saveCosts}>Save costs</button>
            {costsSaved && (
              <span className="sub" style={{ margin: 0 }}>
                Saved ✓
              </span>
            )}
          </div>
        </div>
      )}

      {access === "allowed" && pin && library && (
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

      <BottomNav active="admin" isAdmin={access === "allowed"} />
    </main>
  );
}
