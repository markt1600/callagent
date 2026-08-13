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
      "True ONLY if the restaurant explicitly agreed to the booking (date, time, party size). Confused, unresolved, cut-off, or declined calls are false.",
    ),
  confirmedTime: z
    .string()
    .nullable()
    .describe("The agreed seating time (HH:MM, 24h) if a booking was made, else null"),
  summary: z
    .string()
    .describe("One or two plain-English sentences describing what actually happened on the call"),
});

export interface AnalyzedOutcome {
  success: boolean;
  summary: string;
  confirmedDate?: string;
  confirmedTime?: string;
}

export async function analyzeOutcome(
  reservation: ReservationRequest,
  turns: CallTurn[],
): Promise<AnalyzedOutcome> {
  if (turns.length === 0) {
    return { success: false, summary: "No conversation was captured on this call." };
  }

  const transcript = turns
    .map((t) => `${t.speaker === "agent" ? "Agent" : t.speaker === "operator" ? "Operator" : "Restaurant"}: ${t.text}`)
    .join("\n");

  const client = anthropic();
  const response = await client.beta.messages.parse({
    model: config.anthropic.smartModel,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Audit this restaurant-reservation phone call and decide whether the booking was actually made.

The agent was calling to request: a table for ${reservation.partySize} at ${reservation.restaurantName} on ${reservation.date} at ${reservation.time}${
          reservation.timeWindowStart && reservation.timeWindowEnd
            ? ` (alternatives acceptable between ${reservation.timeWindowStart} and ${reservation.timeWindowEnd})`
            : " (only this exact time acceptable)"
        }, booking name ${reservation.callerName}.

Transcript:
${transcript}

Be strict: mark confirmed=true ONLY if the restaurant clearly accepted the reservation. Apologies, confusion, hang-ups, wrong-number exchanges, "we're full", or an unresolved ending are confirmed=false.`,
      },
    ],
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
  };
}
