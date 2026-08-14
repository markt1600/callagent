"use client";

// Account tab: sign in/out, edit the pre-populated booking name and contact
// number, download the Agent M contact card, and manage saved restaurants.

import { useCallback, useEffect, useState } from "react";
import GoogleSignIn from "../components/GoogleSignIn";
import BottomNav from "../components/BottomNav";
import type { SavedRestaurant, UserProfile } from "@/lib/types";

interface MeResponse {
  user: UserProfile | null;
  authConfigured: boolean;
  googleClientId: string | null;
  agentNumber: string | null;
  isAdmin: boolean;
  creditCosts: Record<string, number>;
}

export default function AccountPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [restaurants, setRestaurants] = useState<SavedRestaurant[]>([]);
  const [bookingName, setBookingName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    name: "",
    phoneNumber: "",
    partySize: 2,
    language: "en",
    specialRequests: "",
    notifyEmail: "",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data: MeResponse = await fetch("/api/me").then((r) => r.json());
      setMe(data);
      if (data.user) {
        setBookingName(data.user.bookingName ?? "");
        setContactPhone(data.user.contactPhone ?? "");
        const rest = await fetch("/api/me/restaurants").then((r) => r.json());
        setRestaurants(rest.restaurants ?? []);
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingName, contactPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      setMe((m) => (m ? { ...m, user: data.user } : m));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("guestMode");
    window.location.href = "/";
  }

  async function forgetRestaurant(id: string) {
    if (!window.confirm("Forget this restaurant and its saved preferences?")) return;
    await fetch(`/api/me/restaurants?id=${id}`, { method: "DELETE" });
    setRestaurants((list) => list.filter((r) => r.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function startEdit(r: SavedRestaurant) {
    setEditingId(r.id);
    setEditError(null);
    setEdit({
      name: r.name,
      phoneNumber: r.phoneNumber,
      partySize: r.partySize ?? 2,
      language: r.language,
      specialRequests: r.specialRequests ?? "",
      notifyEmail: r.notifyEmail ?? "",
    });
  }

  async function saveEdit(id: string) {
    setEditError(null);
    try {
      const res = await fetch("/api/me/restaurants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...edit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      const updated = data.restaurant as SavedRestaurant;
      setRestaurants((list) => list.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  }

  const user = me?.user ?? null;

  return (
    <main style={{ maxWidth: 640 }}>
      <div className="eyebrow">marktan.ai · phone concierge</div>
      <h1>
        <em>Account</em>
      </h1>
      <nav className="tabs">
        <a href="/">Reservations</a>
        <a className="active">Account</a>
      </nav>

      {!me ? (
        <div className="panel">
          <p className="sub">Loading…</p>
        </div>
      ) : !user ? (
        <div className="panel">
          <h2>Sign in</h2>
          <p className="sub">
            Sign in with Google to keep your reservations, restaurants, and preferences on
            your account — repeat bookings then only need a date and time.
          </p>
          {me.authConfigured && me.googleClientId ? (
            <div style={{ marginTop: "0.8rem" }}>
              <GoogleSignIn
                clientId={me.googleClientId}
                onSignedIn={() => load()}
                onError={(msg) => setError(msg)}
              />
            </div>
          ) : (
            <p className="sub">
              Google login is not configured on this deployment — set{" "}
              <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> and <code>AUTH_SECRET</code>.
            </p>
          )}
          <p className="sub" style={{ marginTop: "0.8rem" }}>
            You&apos;re currently in <strong>guest mode</strong> — everything works, but
            reservations aren&apos;t linked to an account.
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <h2 style={{ margin: 0 }}>Profile</h2>
              <a className="admin-link" onClick={signOut} style={{ cursor: "pointer" }}>
                Sign out
              </a>
            </div>
            <p className="sub" style={{ margin: "0.4rem 0 0" }}>
              Signed in as <strong>{user.email}</strong>
            </p>
            <div className="row" style={{ gap: "1.5rem", margin: "0.8rem 0 0.2rem" }}>
              <div>
                <div className="stat">{(user.credits ?? 0).toLocaleString()}</div>
                <div className="stat-label">credits available</div>
              </div>
            </div>
            <p className="sub" style={{ margin: "0.3rem 0 0" }}>
              Each call costs credits by destination —{" "}
              {me &&
                Object.entries(me.creditCosts)
                  .filter(([k]) => k !== "default")
                  .map(([prefix, cost]) => `${prefix} ${cost}`)
                  .join(" · ")}{" "}
              · elsewhere {me?.creditCosts.default ?? 1} per call.
            </p>
            <label>Booking name (pre-filled on every reservation)</label>
            <input
              value={bookingName}
              onChange={(e) => setBookingName(e.target.value)}
              placeholder="Taro Tanaka"
            />
            <label>Contact number (the number given to restaurants)</label>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+6591234567"
            />
            <div className="row">
              <button onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              {saved && (
                <span className="sub" style={{ margin: 0 }}>
                  Saved ✓
                </span>
              )}
            </div>
            {error && <p className="error">{error}</p>}
          </div>

          <div className="panel">
            <h2>Your restaurants</h2>
            {restaurants.length === 0 ? (
              <p className="sub">
                Restaurants you book are remembered here, along with your preferences for
                each — a repeat reservation then only needs a date and time.
              </p>
            ) : (
              restaurants.map((r) => (
                <div key={r.id} className="res-item" style={{ cursor: "default" }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <div>
                      <strong>{r.name}</strong>
                      <div className="meta">
                        {r.phoneNumber} · booked {r.timesBooked}×
                        {r.partySize ? ` · usually ${r.partySize} pax` : ""}
                      </div>
                    </div>
                    <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
                      <button
                        className="delete-btn"
                        title="Edit details"
                        onClick={() => (editingId === r.id ? setEditingId(null) : startEdit(r))}
                        style={{ fontSize: "1rem" }}
                      >
                        ✎
                      </button>
                      <button
                        className="delete-btn"
                        title="Forget this restaurant"
                        onClick={() => forgetRestaurant(r.id)}
                        style={{ fontSize: "1.2rem", color: "var(--err)" }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {editingId === r.id && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <label>Restaurant name</label>
                      <input
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      />
                      <label>Phone number (E.164)</label>
                      <input
                        value={edit.phoneNumber}
                        onChange={(e) => setEdit({ ...edit, phoneNumber: e.target.value })}
                      />
                      <div className="row">
                        <div style={{ flex: "1 1 90px", minWidth: 90 }}>
                          <label>Usual party size</label>
                          <input
                            type="number"
                            min={1}
                            value={edit.partySize}
                            onChange={(e) => setEdit({ ...edit, partySize: Number(e.target.value) })}
                          />
                        </div>
                        <div style={{ flex: "1 1 130px", minWidth: 130 }}>
                          <label>Call language</label>
                          <select
                            value={edit.language}
                            onChange={(e) => setEdit({ ...edit, language: e.target.value })}
                          >
                            <option value="en">English</option>
                            <option value="ja">Japanese</option>
                            <option value="zh">Mandarin</option>
                          </select>
                        </div>
                      </div>
                      <label>Special requests</label>
                      <input
                        value={edit.specialRequests}
                        onChange={(e) => setEdit({ ...edit, specialRequests: e.target.value })}
                      />
                      <label>Email confirmations to</label>
                      <input
                        type="email"
                        value={edit.notifyEmail}
                        onChange={(e) => setEdit({ ...edit, notifyEmail: e.target.value })}
                      />
                      <p className="sub" style={{ margin: "0.5rem 0 0" }}>
                        Seating, occasion, and other preferences refresh automatically from
                        your most recent booking at this restaurant.
                      </p>
                      <div className="row">
                        <button onClick={() => saveEdit(r.id)}>Save changes</button>
                        <button className="secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                      {editError && <p className="error">{editError}</p>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {me?.agentNumber && (
        <div className="panel">
          <h2>Agent M contact card</h2>
          <p className="sub">
            Reservation calls are placed from <strong>{me.agentNumber}</strong>. Save it as a
            contact so you recognize the agent&apos;s calls on iPhone or Android.
          </p>
          <a href="/api/contact-card" style={{ textDecoration: "none" }}>
            <button type="button">⬇ Save Agent M contact</button>
          </a>
        </div>
      )}

      <BottomNav active="account" isAdmin={me?.isAdmin} />
    </main>
  );
}
