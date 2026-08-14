import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

/**
 * vCard for "Agent M" — the Twilio number the agent calls from. Downloading
 * a .vcf opens the native add-contact flow on both iPhone and Android, so
 * users recognize the agent's calls (and any restaurant call-backs to it).
 */
export async function GET() {
  const number = config.twilio.fromNumber;
  if (!number) {
    return NextResponse.json({ error: "Agent phone number not configured" }, { status: 404 });
  }
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:M;Agent;;;",
    "FN:Agent M",
    "ORG:Agentic Concierge",
    `TEL;TYPE=CELL,VOICE:${number}`,
    "NOTE:Agentic Concierge - your concierge calls come from this number.",
    "END:VCARD",
    "",
  ].join("\r\n");

  return new NextResponse(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'attachment; filename="agent-m.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
