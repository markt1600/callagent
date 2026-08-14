"use client";

// Account tab: sign in/out, edit the pre-populated booking name and contact
// number, download the Agent M contact card, and manage saved restaurants.

import { useCallback, useEffect, useState } from "react";
import GoogleSignIn from "../components/GoogleSignIn";
import BottomNav from "../components/BottomNav";
import PhoneInput from "../components/PhoneInput";
import { countryForPrefix } from "@/lib/phone";
import type { CreditTransaction, Friend, SavedRestaurant, UserProfile } from "@/lib/types";

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
  const [ec, setEc] = useState({ name: "", phone: "", email: "", codeword: "", language: "" });
  const [buddyLanguage, setBuddyLanguage] = useState("");

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
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [newFriend, setNewFriend] = useState({ name: "", phoneNumber: "", language: "" });
  const [friendEditingId, setFriendEditingId] = useState<string | null>(null);
  const [friendEdit, setFriendEdit] = useState({ name: "", phoneNumber: "", language: "" });
  const [friendError, setFriendError] = useState<string | null>(null);

  async function addFriend() {
    setFriendError(null);
    const res = await fetch("/api/me/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newFriend.name,
        phoneNumber: newFriend.phoneNumber,
        language: newFriend.language || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFriendError(data.error || `Add failed (${res.status})`);
      return;
    }
    setNewFriend({ name: "", phoneNumber: "", language: "" });
    setFriends((list) => {
      const rest = list.filter((f) => f.id !== data.friend.id);
      return [...rest, data.friend].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function saveFriendEdit(id: string) {
    setFriendError(null);
    const res = await fetch("/api/me/friends", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: friendEdit.name,
        phoneNumber: friendEdit.phoneNumber,
        language: friendEdit.language || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFriendError(data.error || `Save failed (${res.status})`);
      return;
    }
    setFriends((list) =>
      list
        .filter((f) => f.id !== id && f.id !== data.friend.id)
        .concat(data.friend)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setFriendEditingId(null);
  }

  async function deleteFriend(id: string) {
    if (!window.confirm("Remove this friend?")) return;
    await fetch(`/api/me/friends?id=${id}`, { method: "DELETE" });
    setFriends((list) => list.filter((f) => f.id !== id));
    if (friendEditingId === id) setFriendEditingId(null);
  }

  const load = useCallback(async () => {
    try {
      const data: MeResponse = await fetch("/api/me").then((r) => r.json());
      setMe(data);
      if (data.user) {
        setBookingName(data.user.bookingName ?? "");
        setContactPhone(data.user.contactPhone ?? "");
        setEc({
          name: data.user.emergencyContact?.name ?? "",
          phone: data.user.emergencyContact?.phone ?? "",
          email: data.user.emergencyContact?.email ?? "",
          codeword: data.user.emergencyContact?.codeword ?? "",
          language: data.user.emergencyContact?.language ?? "",
        });
        setBuddyLanguage(data.user.buddyLanguage ?? "");
        const rest = await fetch("/api/me/restaurants").then((r) => r.json());
        setRestaurants(rest.restaurants ?? []);
        const tx = await fetch("/api/me/transactions").then((r) => r.json());
        setTransactions(tx.transactions ?? []);
        const fr = await fetch("/api/me/friends").then((r) => r.json());
        setFriends(fr.friends ?? []);
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
        body: JSON.stringify({
          bookingName,
          contactPhone,
          buddyLanguage: buddyLanguage || undefined,
          emergencyContact: ec.name.trim()
            ? {
                name: ec.name,
                phone: ec.phone || undefined,
                email: ec.email || undefined,
                codeword: ec.codeword || undefined,
                language: ec.language || undefined,
              }
            : null,
        }),
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
        <a href="/buddy">Bail Out Call</a>
        <a href="/affirm">Affirmation Call</a>
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
            <p className="sub" style={{ margin: "0.3rem 0 0.2rem" }}>
              Each call costs credits by destination:
            </p>
            <table className="credit-table">
              <tbody>
                {me &&
                  Object.entries(me.creditCosts)
                    .filter(([k]) => k !== "default")
                    .sort(([a], [b]) => countryForPrefix(a).localeCompare(countryForPrefix(b)))
                    .map(([prefix, cost]) => (
                      <tr key={prefix}>
                        <td>
                          {countryForPrefix(prefix)}{" "}
                          <span className="meta" style={{ display: "inline" }}>({prefix})</span>
                        </td>
                        <td>
                          {cost} credit{cost === 1 ? "" : "s"} / call
                        </td>
                      </tr>
                    ))}
                <tr>
                  <td>All other destinations</td>
                  <td>
                    {me?.creditCosts.default ?? 1} credit
                    {(me?.creditCosts.default ?? 1) === 1 ? "" : "s"} / call
                  </td>
                </tr>
              </tbody>
            </table>
            <label>Booking name (pre-filled on every reservation)</label>
            <input
              value={bookingName}
              onChange={(e) => setBookingName(e.target.value)}
              placeholder="Taro Tanaka"
            />
            <label>Contact number (the number given to restaurants)</label>
            <PhoneInput value={contactPhone} onChange={setContactPhone} />
            <label>Bail out call language</label>
            <select value={buddyLanguage} onChange={(e) => setBuddyLanguage(e.target.value)}>
              <option value="">English (default)</option>
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <details style={{ marginTop: "0.9rem" }}>
              <summary className="sub" style={{ cursor: "pointer", marginBottom: 0 }}>
                Emergency contact (used by Bail Out Call)
              </summary>
              <p className="sub" style={{ margin: "0.6rem 0 0" }}>
                Pre-fills the emergency section of every bail out call. Clear the name to
                remove it.
              </p>
              <label>Contact name</label>
              <input
                value={ec.name}
                onChange={(e) => setEc({ ...ec, name: e.target.value })}
                placeholder="Sarah Tan"
              />
              <label>Contact phone</label>
              <PhoneInput
                value={ec.phone}
                onChange={(v) => setEc({ ...ec, phone: v })}
                placeholder="98765432"
              />
              <label>Contact email</label>
              <input
                type="email"
                value={ec.email}
                onChange={(e) => setEc({ ...ec, email: e.target.value })}
                placeholder="sarah@example.com"
              />
              <label>Contact&apos;s language</label>
              <select
                value={ec.language}
                onChange={(e) => setEc({ ...ec, language: e.target.value })}
              >
                <option value="">Same as the bail out call</option>
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label>Emergency codeword</label>
              <input
                value={ec.codeword}
                onChange={(e) => setEc({ ...ec, codeword: e.target.value })}
                placeholder="e.g. redwood"
              />
            </details>
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
            <h2>Credit history</h2>
            {transactions.length === 0 ? (
              <p className="sub">
                Every credit deduction (and addition) will be listed here.
              </p>
            ) : (
              <table className="credit-table">
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-faint)" }}>
                        {new Date(t.at).toLocaleDateString()}{" "}
                        {new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td>{t.description}</td>
                      <td style={{ color: t.delta < 0 ? "var(--err)" : "#2f6f4f", fontWeight: 600 }}>
                        {t.delta > 0 ? `+${t.delta.toLocaleString()}` : t.delta.toLocaleString()}
                      </td>
                      <td style={{ color: "var(--ink-faint)" }}>
                        {t.balanceAfter.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                      <label>Phone number</label>
                      <PhoneInput
                        value={edit.phoneNumber}
                        onChange={(v) => setEdit({ ...edit, phoneNumber: v })}
                        defaultCountry="+81"
                        placeholder="312345678"
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
                            <option value="de">German</option>
                            <option value="ko">Korean</option>
                            <option value="fr">French</option>
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

          <div className="panel">
            <h2>Your friends</h2>
            <p className="sub" style={{ marginTop: 0 }}>
              Friends can be picked as the recipient of an Affirmation Call, with their
              saved details applied. Anyone you send an affirmation call to is added
              automatically.
            </p>
            {friends.map((f) => (
              <div key={f.id} className="res-item" style={{ cursor: "default" }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <div>
                    <strong>{f.name}</strong>
                    <div className="meta">
                      {f.phoneNumber}
                      {f.language ? ` · ${LANGUAGE_OPTIONS.find((o) => o.value === f.language)?.label ?? f.language}` : ""}
                      {f.timesCalled ? ` · ${f.timesCalled} call${f.timesCalled > 1 ? "s" : ""}` : ""}
                    </div>
                  </div>
                  <span className="row" style={{ flexShrink: 0, gap: "0.2rem" }}>
                    <button
                      className="delete-btn"
                      title="Edit"
                      onClick={() => {
                        if (friendEditingId === f.id) {
                          setFriendEditingId(null);
                        } else {
                          setFriendEditingId(f.id);
                          setFriendEdit({
                            name: f.name,
                            phoneNumber: f.phoneNumber,
                            language: f.language ?? "",
                          });
                        }
                      }}
                      style={{ fontSize: "1rem" }}
                    >
                      ✎
                    </button>
                    <button
                      className="delete-btn"
                      title="Remove friend"
                      onClick={() => deleteFriend(f.id)}
                      style={{ fontSize: "1.2rem", color: "var(--err)" }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {friendEditingId === f.id && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label>Name</label>
                    <input
                      value={friendEdit.name}
                      onChange={(e) => setFriendEdit({ ...friendEdit, name: e.target.value })}
                    />
                    <label>Phone</label>
                    <PhoneInput
                      value={friendEdit.phoneNumber}
                      onChange={(v) => setFriendEdit({ ...friendEdit, phoneNumber: v })}
                    />
                    <label>Preferred language</label>
                    <select
                      value={friendEdit.language}
                      onChange={(e) => setFriendEdit({ ...friendEdit, language: e.target.value })}
                    >
                      <option value="">Not set</option>
                      {LANGUAGE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="row">
                      <button onClick={() => saveFriendEdit(f.id)}>Save changes</button>
                      <button className="secondary" onClick={() => setFriendEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <label style={{ marginTop: "1rem" }}>Add a friend</label>
            <div className="row">
              <input
                value={newFriend.name}
                onChange={(e) => setNewFriend({ ...newFriend, name: e.target.value })}
                placeholder="Name"
                style={{ flex: "1 1 120px", minWidth: 120 }}
              />
              <select
                value={newFriend.language}
                onChange={(e) => setNewFriend({ ...newFriend, language: e.target.value })}
                style={{ flex: "1 1 120px", minWidth: 120 }}
              >
                <option value="">Language…</option>
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginTop: "0.4rem" }}>
              <PhoneInput
                value={newFriend.phoneNumber}
                onChange={(v) => setNewFriend({ ...newFriend, phoneNumber: v })}
              />
            </div>
            <button className="secondary" onClick={addFriend}>
              + Add friend
            </button>
            {friendError && <p className="error">{friendError}</p>}
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
