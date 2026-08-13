// Confirmation delivery: when a call completes, email the requester the
// outcome and the full call transcript so they can verify what was agreed.
// Uses the Resend REST API directly (no SDK). Skips silently when not
// configured — notifications are optional.

import { config } from "./config";
import { getJSON, setJSON } from "./store";
import type { CallSession, ReservationRequest } from "./types";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.CONFIRMATION_FROM_EMAIL || "";
const FROM_NAME = process.env.CONFIRMATION_FROM_NAME || "CallAgent";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function speakerLabel(speaker: string): string {
  if (speaker === "agent") return "Agent";
  if (speaker === "operator") return "Operator";
  return "Restaurant";
}

function buildEmail(reservation: ReservationRequest, call: CallSession | null) {
  const ok = reservation.outcome?.success;
  const subject = ok
    ? `✅ Reservation confirmed — ${reservation.restaurantName}, ${reservation.date} ${reservation.time}`
    : `⚠️ Reservation not confirmed — ${reservation.restaurantName}`;

  const transcriptRows = (call?.turns ?? [])
    .map((t) => {
      const gloss =
        t.english && t.english !== t.text
          ? `<div style="color:#667;font-size:12px">${escapeHtml(t.english)}</div>`
          : "";
      return `<tr>
        <td style="padding:6px 10px;vertical-align:top;color:#889;font-size:12px;white-space:nowrap">${speakerLabel(t.speaker)}</td>
        <td style="padding:6px 10px">${escapeHtml(t.text)}${gloss}</td>
      </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px;margin:0 auto;color:#223">
    <h2 style="margin:16px 0 4px">${ok ? "Reservation confirmed 🎉" : "Reservation not confirmed"}</h2>
    <p style="margin:4px 0 16px;color:#556">${escapeHtml(reservation.outcome?.summary ?? "The call has completed — please review the transcript below.")}</p>
    <table style="border-collapse:collapse;background:#f6f7f9;border-radius:8px;width:100%;margin-bottom:20px">
      <tr><td style="padding:8px 12px;color:#889">Restaurant</td><td style="padding:8px 12px"><b>${escapeHtml(reservation.restaurantName)}</b></td></tr>
      <tr><td style="padding:8px 12px;color:#889">Date &amp; time</td><td style="padding:8px 12px"><b>${escapeHtml(reservation.date)} ${escapeHtml(reservation.time)}</b></td></tr>
      <tr><td style="padding:8px 12px;color:#889">Party size</td><td style="padding:8px 12px"><b>${reservation.partySize}</b></td></tr>
      <tr><td style="padding:8px 12px;color:#889">Booking name</td><td style="padding:8px 12px"><b>${escapeHtml(reservation.callerName)}</b></td></tr>
      ${reservation.contactPhone ? `<tr><td style="padding:8px 12px;color:#889">Contact number</td><td style="padding:8px 12px"><b>${escapeHtml(reservation.contactPhone)}</b></td></tr>` : ""}
      ${reservation.specialRequests ? `<tr><td style="padding:8px 12px;color:#889">Special requests</td><td style="padding:8px 12px">${escapeHtml(reservation.specialRequests)}</td></tr>` : ""}
    </table>
    ${
      transcriptRows
        ? `<h3 style="margin:0 0 8px">Call transcript</h3>
           <table style="border-collapse:collapse;width:100%;border:1px solid #e3e6eb;border-radius:8px">${transcriptRows}</table>`
        : `<p style="color:#889">No transcript was captured for this call.</p>`
    }
    <p style="color:#99a;font-size:12px;margin-top:20px">Sent by CallAgent — please verify the details above; if anything looks wrong, call the restaurant to correct it.</p>
  </div>`;

  return { subject, html };
}

/**
 * Email the confirmation for a completed reservation, exactly once.
 * No-op when Resend isn't configured or the reservation has no notifyEmail.
 */
export async function sendConfirmation(
  reservationId: string,
  call: CallSession | null,
): Promise<void> {
  if (!RESEND_API_KEY || !FROM_EMAIL) return;

  const reservation = await getJSON<ReservationRequest>(`res:${reservationId}`);
  if (!reservation?.notifyEmail || reservation.confirmationSentAt) return;

  const { subject, html } = buildEmail(reservation, call);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [reservation.notifyEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    console.error(`Confirmation email failed (${res.status}):`, await res.text());
    return;
  }
  reservation.confirmationSentAt = new Date().toISOString();
  await setJSON(`res:${reservationId}`, reservation);
}
