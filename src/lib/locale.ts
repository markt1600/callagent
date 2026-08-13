// Speech-recognition locale selection for Twilio <Gather>.
//
// Recognition accuracy improves noticeably when the locale matches the
// regional accent, so for English calls we pick the variant from the
// destination country code (e.g. +65 -> en-SG for Singapore).

import type { SupportedLanguage } from "./types";

const ENGLISH_LOCALES_BY_PREFIX: [string, string][] = [
  ["+65", "en-SG"], // Singapore
  ["+44", "en-GB"],
  ["+61", "en-AU"],
  ["+64", "en-NZ"],
  ["+91", "en-IN"],
  ["+63", "en-PH"],
  ["+1", "en-US"],
];

export function speechLocaleFor(language: SupportedLanguage, phoneNumber: string): string {
  if (language === "ja") return "ja-JP";
  for (const [prefix, locale] of ENGLISH_LOCALES_BY_PREFIX) {
    if (phoneNumber.startsWith(prefix)) return locale;
  }
  return "en-US";
}
