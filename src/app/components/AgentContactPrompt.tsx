"use client";

// One-time prompt (first guest visit / first login) suggesting the user save
// the agent's outbound number as a contact named "Agent M". The /api/contact-card
// vCard opens the native add-contact flow on both iPhone and Android.

export default function AgentContactPrompt({
  agentNumber,
  onDismiss,
}: {
  agentNumber: string;
  onDismiss: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <h2 style={{ margin: 0 }}>Save the agent&apos;s number</h2>
          <button
            type="button"
            className="delete-btn"
            title="Close"
            onClick={onDismiss}
            style={{ fontSize: "1.15rem", color: "var(--muted)", flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
        <p className="sub" style={{ marginTop: "0.5rem" }}>
          Your reservation calls are placed from <strong>{agentNumber}</strong>. Save it as a
          contact — <strong>Agent M</strong> — so you recognize it if you ever need to pick up.
          On iPhone or Android, downloading the contact card opens your contacts app directly.
        </p>
        <div className="row">
          {/* Downloading counts as done — the prompt won't show again. */}
          <a href="/api/contact-card" style={{ textDecoration: "none" }} onClick={onDismiss}>
            <button type="button">⬇ Save Agent M contact</button>
          </a>
          <button type="button" className="secondary" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
