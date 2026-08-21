"use client";

// Admin page: PIN-gated list of all reservations with one-tap delete.
// The PIN is verified server-side on every delete (x-admin-pin header).

import { useCallback, useEffect, useState } from "react";
import BottomNav from "../components/BottomNav";
import PhoneInput from "../components/PhoneInput";
import { countryForPrefix } from "@/lib/phone";
import type { LibraryEntry, PersonMemory, ReservationRequest } from "@/lib/types";

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
  const [users, setUsers] = useState<
    Array<{
      id: string;
      email: string;
      name: string;
      createdAt?: string;
      credits: number;
      contactPhone: string | null;
      bookingName?: string;
      buddyLanguage?: string;
      lastActiveAt?: string | null;
      friends?: Array<{ id: string; name: string; phoneNumber: string; language: string }>;
    }>
  >([]);
  const [adminMemories, setAdminMemories] = useState<PersonMemory[]>([]);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [userEdit, setUserEdit] = useState({ bookingName: "", contactPhone: "", buddyLanguage: "" });
  const [userError, setUserError] = useState<string | null>(null);

  const USER_LANGUAGE_OPTIONS = [
    { value: "en", label: "English" },
    { value: "zh", label: "Chinese (Mandarin)" },
    { value: "ja", label: "Japanese" },
    { value: "th", label: "Thai" },
    { value: "vi", label: "Vietnamese" },
    { value: "de", label: "German" },
    { value: "ko", label: "Korean" },
    { value: "fr", label: "French" },
  ];

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

  const loadUsers = useCallback(async () => {
    const stored = sessionStorage.getItem("adminPin");
    if (!stored) return;
    try {
      const res = await fetch("/api/admin/users", { headers: { "x-admin-pin": stored } });
      const data = await res.json();
      if (res.ok && data.users) setUsers(data.users);
    } catch {
      /* transient */
    }
  }, []);

  const loadMemories = useCallback(async () => {
    const stored = sessionStorage.getItem("adminPin");
    if (!stored) return;
    try {
      const res = await fetch("/api/admin/memory", { headers: { "x-admin-pin": stored } });
      const data = await res.json();
      if (res.ok && data.memories) setAdminMemories(data.memories);
    } catch {
      /* transient */
    }
  }, []);

  async function saveUserEdit(id: string) {
    if (!pin) return;
    setUserError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-pin": pin },
      body: JSON.stringify({ id, ...userEdit }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUserError((data as { error?: string }).error || `Save failed (${res.status})`);
      if (res.status === 401) lock();
      return;
    }
    setUserEditingId(null);
    loadUsers();
  }

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
      loadUsers();
      loadMemories();
    }
  }, [pin, refresh, loadCosts, loadUsers, loadMemories]);

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
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a href="/buddy">Bail Out Call</a>
        <a href="/affirm">Affirmation Call</a>
        <a href="/chat">Live Chat</a>
        <a href="/account">Account</a>
        <a className="active">Admin</a>
      </nav>
      <p className="sub">
        Owner-only controls: reservations across all users, credit costs, accounts, and
        memory files.
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
              <span className="sub" style={{ margin: 0, flex: "1 1 90px", minWidth: 90 }}>
                {c.prefix === "default"
                  ? "everywhere else"
                  : countryForPrefix(c.prefix) !== c.prefix
                    ? countryForPrefix(c.prefix)
                    : ""}
              </span>
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

      {access === "allowed" && pin && (
        <div className="panel">
          <h2>Users</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Every account that has signed in with Google ({users.length} total).
          </p>
          {users.length === 0 ? (
            <p className="sub">No signed-in users yet.</p>
          ) : (
            users.map((u) => (
              <div key={u.id} className="res-item" style={{ cursor: "default" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <div>
                    <strong>{u.name || u.email}</strong>
                    <div className="meta">
                      {u.email}
                      {u.contactPhone ? ` · ${u.contactPhone}` : " · no phone saved"}
                      {u.createdAt
                        ? ` · joined ${new Date(u.createdAt).toLocaleDateString()}`
                        : ""}
                      {u.lastActiveAt
                        ? ` · last active ${new Date(u.lastActiveAt).toLocaleDateString()}`
                        : " · not active yet"}
                    </div>
                  </div>
                  <span className="row" style={{ flexShrink: 0, gap: "0.5rem", alignItems: "center" }}>
                    <span className="sub" style={{ margin: 0 }}>
                      {u.credits.toLocaleString()} credits
                    </span>
                    <button
                      className="delete-btn"
                      title="Edit user"
                      onClick={() => {
                        if (userEditingId === u.id) {
                          setUserEditingId(null);
                        } else {
                          setUserEditingId(u.id);
                          setUserError(null);
                          setUserEdit({
                            bookingName: u.bookingName ?? "",
                            contactPhone: u.contactPhone ?? "",
                            buddyLanguage: u.buddyLanguage ?? "",
                          });
                        }
                      }}
                      style={{ fontSize: "1rem" }}
                    >
                      ✎
                    </button>
                  </span>
                </div>
                {userEditingId === u.id && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label>Booking name</label>
                    <input
                      value={userEdit.bookingName}
                      onChange={(e) => setUserEdit({ ...userEdit, bookingName: e.target.value })}
                      placeholder="First Last"
                    />
                    <label>Contact number (links their memory by phone)</label>
                    <PhoneInput
                      value={userEdit.contactPhone}
                      onChange={(v) => setUserEdit({ ...userEdit, contactPhone: v })}
                    />
                    <label>Preferred language</label>
                    <select
                      value={userEdit.buddyLanguage}
                      onChange={(e) =>
                        setUserEdit({ ...userEdit, buddyLanguage: e.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      {USER_LANGUAGE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="row">
                      <button onClick={() => saveUserEdit(u.id)}>Save changes</button>
                      <button className="secondary" onClick={() => setUserEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                    {userError && <p className="error">{userError}</p>}
                    <label style={{ marginTop: "0.8rem" }}>Their friends</label>
                    {!u.friends?.length ? (
                      <p className="sub" style={{ margin: 0 }}>
                        No friends saved on this account.
                      </p>
                    ) : (
                      u.friends.map((f) => (
                        <div key={f.id} className="meta" style={{ padding: "0.15rem 0" }}>
                          <strong>{f.name}</strong> · {f.phoneNumber}
                          {f.language
                            ? ` · ${USER_LANGUAGE_OPTIONS.find((o) => o.value === f.language)?.label ?? f.language}`
                            : ""}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {access === "allowed" && pin && (
        <div className="panel">
          <h2>Memory files</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Every per-person memory in the system ({adminMemories.length} total). Memory
            belongs to the person, matched by phone number — erasing one clears it for
            every account that talks to them.
          </p>
          {adminMemories.length === 0 ? (
            <p className="sub">No memories yet.</p>
          ) : (
            adminMemories.map((m) => (
              <div key={m.personKey} className="res-item" style={{ cursor: "default" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <div>
                    <strong>{m.personName || m.personKey}</strong>
                    <div className="meta">
                      +{m.personKey}
                      {" · "}
                      {m.conversationCount} conversation{m.conversationCount === 1 ? "" : "s"}
                      {m.lastConversationAt
                        ? ` · last ${new Date(m.lastConversationAt).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    title="Erase this memory"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Erase everything remembered about ${m.personName || "this person"}? This cannot be undone.`,
                        )
                      )
                        return;
                      const stored = sessionStorage.getItem("adminPin");
                      await fetch(`/api/admin/memory?key=${encodeURIComponent(m.personKey)}`, {
                        method: "DELETE",
                        headers: stored ? { "x-admin-pin": stored } : undefined,
                      });
                      setAdminMemories((list) =>
                        list.filter((x) => x.personKey !== m.personKey),
                      );
                    }}
                    style={{ fontSize: "1.2rem", color: "var(--err)", flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                  {m.summary}
                </p>
              </div>
            ))
          )}
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
