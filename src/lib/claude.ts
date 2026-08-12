import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Shared Anthropic client (reads ANTHROPIC_API_KEY from the environment). */
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** Throw a readable error if the model declined the request. */
export function assertNotRefusal(message: {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
}) {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    throw new Error(`Model declined the request${category ? ` (${category})` : ""}`);
  }
}
