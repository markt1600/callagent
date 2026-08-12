// Live translation, both directions, using the fast model to keep the
// relay loop responsive.

import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";

export async function translate(
  text: string,
  from: "ja" | "en",
  to: "ja" | "en",
): Promise<string> {
  if (from === to || !text.trim()) return text;
  const client = anthropic();
  const target = to === "ja" ? "polite Japanese (natural keigo for a phone call)" : "English";
  const response = await client.messages.create({
    model: config.anthropic.fastModel,
    max_tokens: 500,
    system: `Translate the user's message into ${target}. Output ONLY the translation, nothing else.`,
    messages: [{ role: "user", content: text }],
  });
  assertNotRefusal(response);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Translation failed");
  return block.text.trim();
}
