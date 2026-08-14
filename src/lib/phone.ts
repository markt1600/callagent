// Country prefixes: names for display, destination-aware formatting of
// the guest contact number given out on calls, and destination-local time
// interpretation (a scheduled time is wall-clock time where the phone is).

import { tzOffsetHours } from "./callWindow";

const HOUR_MS = 3_600_000;

interface CountryInfo {
  prefix: string;
  name: string;
  /** Trunk digit prepended when dialing domestically ("0" in Japan, none in Singapore). */
  trunk: string;
}

const COUNTRIES: CountryInfo[] = [
  { prefix: "+65", name: "Singapore", trunk: "" },
  { prefix: "+81", name: "Japan", trunk: "0" },
  { prefix: "+852", name: "Hong Kong", trunk: "" },
  { prefix: "+853", name: "Macau", trunk: "" },
  { prefix: "+886", name: "Taiwan", trunk: "0" },
  { prefix: "+82", name: "South Korea", trunk: "0" },
  { prefix: "+86", name: "China", trunk: "0" },
  { prefix: "+66", name: "Thailand", trunk: "0" },
  { prefix: "+60", name: "Malaysia", trunk: "0" },
  { prefix: "+62", name: "Indonesia", trunk: "0" },
  { prefix: "+84", name: "Vietnam", trunk: "0" },
  { prefix: "+63", name: "Philippines", trunk: "0" },
  { prefix: "+91", name: "India", trunk: "0" },
  { prefix: "+61", name: "Australia", trunk: "0" },
  { prefix: "+64", name: "New Zealand", trunk: "0" },
  { prefix: "+44", name: "United Kingdom", trunk: "0" },
  { prefix: "+33", name: "France", trunk: "0" },
  { prefix: "+49", name: "Germany", trunk: "0" },
  { prefix: "+39", name: "Italy", trunk: "" },
  { prefix: "+34", name: "Spain", trunk: "" },
  { prefix: "+1", name: "US / Canada", trunk: "" },
];

/** Longest-prefix country match for an E.164-ish number, or null. */
export function countryOf(phoneNumber: string): CountryInfo | null {
  let best: CountryInfo | null = null;
  for (const c of COUNTRIES) {
    if (phoneNumber.startsWith(c.prefix) && (!best || c.prefix.length > best.prefix.length)) {
      best = c;
    }
  }
  return best;
}

/** Display name for a "+NN" prefix (e.g. "+81" → "Japan"); falls back to the prefix. */
export function countryForPrefix(prefix: string): string {
  return COUNTRIES.find((c) => c.prefix === prefix)?.name ?? prefix;
}

/**
 * The guest contact number as it should be given out on a call to
 * `restaurantPhone`: domestic format (country code dropped, trunk digit
 * added) when both numbers are in the same country — a Singapore restaurant
 * hears "9750 8007", not "+65 9750 8007" — and the full international
 * number otherwise.
 */
/** Human label for a number's timezone: "Singapore time", "Japan time"… */
export function destinationTimeLabel(phoneNumber: string): string {
  const c = countryOf(phoneNumber);
  if (c) return `${c.name} time`;
  const offset = tzOffsetHours(phoneNumber);
  return `UTC${offset >= 0 ? "+" : ""}${offset}`;
}

/**
 * Interpret a naive wall-clock string ("2026-08-14T19:30") as local time in
 * the phone number's country (+65 → Singapore, +81 → Japan) and return the
 * UTC instant. Null if the string isn't a plain wall-clock datetime.
 */
export function destinationWallClockToUtc(wallClock: string, phoneNumber: string): Date | null {
  const m = wallClock.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(asUtc - tzOffsetHours(phoneNumber) * HOUR_MS);
}

/** ISO instant → the destination's wall-clock "YYYY-MM-DDTHH:mm" (for form inputs). */
export function isoToDestinationWallClock(iso: string, phoneNumber: string): string {
  const local = new Date(new Date(iso).getTime() + tzOffsetHours(phoneNumber) * HOUR_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Format an ISO instant as wall-clock time in the number's country, labeled. */
export function formatInDestination(iso: string, phoneNumber: string): string {
  const local = new Date(new Date(iso).getTime() + tzOffsetHours(phoneNumber) * HOUR_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} (${destinationTimeLabel(phoneNumber)})`;
}

export function contactNumberForCall(contactPhone: string, restaurantPhone: string): string {
  const contact = contactPhone.replace(/[\s-]/g, "");
  const contactCountry = countryOf(contact);
  const restaurantCountry = countryOf(restaurantPhone);
  if (!contactCountry || !restaurantCountry || contactCountry.prefix !== restaurantCountry.prefix) {
    return contactPhone;
  }
  return contactCountry.trunk + contact.slice(contactCountry.prefix.length);
}
