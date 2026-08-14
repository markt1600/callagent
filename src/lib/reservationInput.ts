// Shared parsing/validation for reservation create + edit input.

import type { ReservationPreferences } from "./types";

/** Sanitize client-supplied preferences to known keys/values. */
export function parsePreferences(raw: unknown): ReservationPreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const prefs: ReservationPreferences = {};
  if (p.seating === "indoor" || p.seating === "outdoor" || p.seating === "counter")
    prefs.seating = p.seating;
  if (typeof p.minimumSpendOk === "boolean") prefs.minimumSpendOk = p.minimumSpendOk;
  if (p.smoking === "non_smoking" || p.smoking === "smoking") prefs.smoking = p.smoking;
  if (typeof p.timeLimitOk === "boolean") prefs.timeLimitOk = p.timeLimitOk;
  if (p.privateRoom === true) prefs.privateRoom = true;
  if (p.quietTable === true) prefs.quietTable = true;
  const kids = Number(p.kidsCount);
  if (Number.isInteger(kids) && kids > 0 && kids < 20) {
    prefs.kidsCount = kids;
    if (p.kidsSeating === true) prefs.kidsSeating = true;
  }
  if (
    p.occasion === "birthday" ||
    p.occasion === "anniversary" ||
    p.occasion === "business" ||
    p.occasion === "date"
  ) {
    prefs.occasion = p.occasion;
    if (typeof p.occasionName === "string" && p.occasionName.trim())
      prefs.occasionName = p.occasionName.trim().slice(0, 100);
    if (p.occasion === "birthday" && p.birthdayCake === true) prefs.birthdayCake = true;
  }
  if (typeof p.allergies === "string" && p.allergies.trim())
    prefs.allergies = p.allergies.trim().slice(0, 300);
  if (p.accessibility === true) prefs.accessibility = true;
  if (p.askCorkage === true) prefs.askCorkage = true;
  return Object.keys(prefs).length ? prefs : undefined;
}
