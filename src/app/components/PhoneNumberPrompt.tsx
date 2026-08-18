"use client";

// Shown to signed-in accounts that haven't saved a contact number yet.
// Memory (and the caller-recognition features) key off the phone number, so
// a new Google account is asked for it right away. Dismissible — it comes
// back next visit until a number is saved.

import { useState } from "react";
import PhoneInput from "./PhoneInput";

export default function PhoneNumberPrompt({
  onSaved,
  onDismiss,
}: {
  onSaved: (phone: string) => void;
  onDismiss: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!phone.trim()) {
      setError("Enter your phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactPhone: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      onSaved(phone);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <h2 style={{ margin: 0 }}>Add your phone number</h2>
        <button
          className="delete-btn"
          title="Later"
          onClick={onDismiss}
          style={{ fontSize: "1.15rem", color: "var(--muted)", flexShrink: 0 }}
        >
          ✕
        </button>
      </div>
      <p className="sub">
        The agents&apos; memory of you is tied to your phone number — save it so calls to
        you and your own chats build one continuous memory.
      </p>
      <PhoneInput value={phone} onChange={setPhone} />
      <button onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save number"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
