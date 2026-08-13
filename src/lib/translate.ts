// Live translation between supported languages, using the fast model to
// keep the relay loop responsive.

import { anthropic, assertNotRefusal } from "./claude";
import { config } from "./config";
import type { SupportedLanguage } from "./types";

const TARGET_STYLE: Record<SupportedLanguage, string> = {
  ja: "polite Japanese (natural keigo for a phone call)",
  en: "English",
  zh: "polite spoken Mandarin (普通话, simplified characters, natural for a phone call)",
};

export async function translate(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage,
): Promise<string> {
  if (from === to || !text.trim()) return text;
  const client = anthropic();
  const response = await client.messages.create({
    model: config.anthropic.fastModel,
    max_tokens: 500,
    system: `Translate the user's message into ${TARGET_STYLE[to]}. Output ONLY the translation, nothing else.`,
    messages: [{ role: "user", content: text }],
  });
  assertNotRefusal(response);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Translation failed");
  return block.text.trim();
}
