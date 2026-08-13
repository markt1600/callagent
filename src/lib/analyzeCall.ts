// Independent post-call verification. We do NOT trust the telephony
// provider's success flag — Claude audits the actual transcript against the
// reservation request and only reports success when the restaurant
// explicitly agreed to the booking.

import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import type { CallTurn, ReservationRequest } from "./types";

const OutcomeSchema = z.object({
  confirmed: z
    .boolean()
    .describe(
      "True if the restaurant agreed to the booking (date, time, party size). Explicit acceptance counts, and so does a polite acknowledgment (e.g. 'thank you', 'see you then') after the agent stated or read back the full booking details, as long as the restaurant raised no objection. Declined, confused, cut-off-mid-request, or wrong-number calls are false.",
    ),
  confirmedTime: z
    .string()
    .nullable()
    .describe("The agreed seating time (HH:MM, 24h) if a booking was made, else null"),
  corkagePolicy: z
    .string()
    .nullable()
    .describe(
      "If corkage was discussed: the restaurant's corkage policy in one plain-English sentence (allowed or not, fee per bottle). Null if corkage never came up.",
    ),
  summary: z
    .string()
    .describe("One or two plain-English sentences describing what actually happened on the call"),
});

export interface AnalyzedOutcome {
  success: boolean;
  summary: string;
  confirmedDate?: string;
  confirmedTime?: string;
  corkagePolicy?: string;
}

export async function analyzeOutcome(
  reservation: ReservationRequest,
  turns: CallTurn[],
  purpose: "book" | "cancel" = "book",
): Promise<AnalyzedOutcome> {
  if (turns.length === 0) {
    return { success: false, summary: "No conversation was captured on this call." };
  }

  const transcript = turns
    .map((t) => `${t.speaker === "agent" ? "Agent" : t.speaker === "operator" ? "Operator" : "Restaurant"}: ${t.text}`)
    .join("\n");

  const brief =
    purpose === "cancel"
      ? `Audit this phone call and decide whether an existing reservation was actually CANCELLED.

The agent was calling ${reservation.restaurantName} to cancel the booking under ${reservation.callerName} for ${reservation.partySize} on ${reservation.outcome?.confirmedDate ?? reservation.date} at ${reservation.outcome?.confirmedTime ?? reservation.time}.

Transcript:
${transcript}

Decision rule: mark confirmed=true if the restaurant acknowledged the cancellation. Explicit acceptance counts, and so does a polite, non-negative acknowledgment ("thank you", "understood", "かしこまりました") after the agent clearly stated which booking to cancel, with no objection raised. Mark confirmed=false only for: a refusal, the restaurant unable to find the booking without resolution, obvious mutual confusion, or the call cutting off before the cancellation request was conveyed.`
      : `Audit this restaurant-reservation phone call and decide whether the booking was actually made.

The agent was calling to request: a table for ${reservation.partySize} at ${reservation.restaurantName} on ${reservation.date} at ${reservation.time}${
          reservation.timeWindowStart && reservation.timeWindowEnd
            ? ` (alternatives acceptable between ${reservation.timeWindowStart} and ${reservation.timeWindowEnd})`
            : " (only this exact time acceptable)"
        }, booking name ${reservation.callerName}.

Transcript:
${transcript}

Decision rule: mark confirmed=true if the restaurant accepted the reservation. Explicit acceptance ("yes, we have you down", "かしこまりました") counts. ALSO count as accepted: the agent stated or read back the full booking details and the restaurant responded with a polite, non-negative acknowledgment ("thank you", "see you then", "ありがとうございます") without objecting or declining — restaurant staff often close a call this way instead of restating the booking. Mark confirmed=false only for: an explicit decline ("we're full", "we can't take that"), the restaurant objecting to the details without resolution, a wrong-number exchange, obvious mutual confusion, or the call cutting off BEFORE the booking details were fully conveyed.${
          reservation.preferences?.privateRoom
            ? " A PRIVATE ROOM was required for this booking — mark confirmed=true only if a private room was actually secured."
            : ""
        }${
          reservation.preferences?.askCorkage
            ? " The agent was instructed to ask about the corkage policy — extract whatever the restaurant said about it into corkagePolicy."
            : ""
        }`;

  const client = anthropic();
  const response = await client.beta.messages.parse({
    model: config.anthropic.smartModel,
    max_tokens: 2000,
    messages: [{ role: "user", content: brief }],
    output_format: betaZodOutputFormat(OutcomeSchema),
  });
  assertNotRefusal(response);
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Outcome analysis returned no parseable output");

  return {
    success: parsed.confirmed,
    summary: parsed.summary,
    confirmedDate: parsed.confirmed ? reservation.date : undefined,
    confirmedTime: parsed.confirmed ? (parsed.confirmedTime ?? reservation.time) : undefined,
    corkagePolicy: parsed.corkagePolicy ?? undefined,
  };
}
