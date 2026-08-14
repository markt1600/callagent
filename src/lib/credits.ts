// Account credits. Every outbound call costs credits, priced by destination
// country prefix (editable in Admin). New accounts start with a fixed grant;
// each call attempt deducts its cost before dialing. Guest-mode reservations
// have no account and are not charged.

import { getJSON, setJSON } from "./store";
import type { UserProfile } from "./types";

export const STARTING_CREDITS = 100_000;

const COSTS_KEY = "config:creditCosts";

/** Built-in prices: Singapore 1, Japan 2, anywhere else 1. */
const DEFAULT_COSTS: Record<string, number> = { "+65": 1, "+81": 2, default: 1 };

/** Effective per-prefix call costs (admin overrides merged over defaults). */
export async function getCreditCosts(): Promise<Record<string, number>> {
  const stored = await getJSON<Record<string, number>>(COSTS_KEY);
  return { ...DEFAULT_COSTS, ...(stored ?? {}) };
}

/** Persist admin-edited costs. Keys are "+<prefix>" or "default". */
export async function setCreditCosts(
  costs: Record<string, unknown>,
): Promise<Record<string, number>> {
  const clean: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(costs)) {
    const key = rawKey.trim();
    const n = Number(rawValue);
    if ((key === "default" || /^\+\d{1,4}$/.test(key)) && Number.isFinite(n) && n >= 0) {
      clean[key] = Math.round(n);
    }
  }
  await setJSON(COSTS_KEY, clean);
  return { ...DEFAULT_COSTS, ...clean };
}

/** Cost of calling a number: longest matching prefix wins, else the default. */
export function costForNumber(phoneNumber: string, costs: Record<string, number>): number {
  let best: number | null = null;
  let bestLen = -1;
  for (const [prefix, cost] of Object.entries(costs)) {
    if (prefix !== "default" && phoneNumber.startsWith(prefix) && prefix.length > bestLen) {
      best = cost;
      bestLen = prefix.length;
    }
  }
  return best ?? costs.default ?? 1;
}

/** A user's balance — accounts created before credits existed get the grant. */
export function creditsOf(user: UserProfile): number {
  return user.credits ?? STARTING_CREDITS;
}

/**
 * Deduct the cost of one call to `phoneNumber` from the user's balance.
 * Fails (without deducting) when the balance can't cover it.
 */
export async function chargeForCall(
  userId: string,
  phoneNumber: string,
): Promise<{ ok: true; cost: number; remaining: number } | { ok: false; error: string }> {
  const user = await getJSON<UserProfile>(`user:${userId}`);
  // Orphaned reservation (account deleted): don't block the call.
  if (!user) return { ok: true, cost: 0, remaining: 0 };
  const costs = await getCreditCosts();
  const cost = costForNumber(phoneNumber, costs);
  const balance = creditsOf(user);
  if (balance < cost) {
    return { ok: false, error: `Not enough credits — this call costs ${cost}, balance is ${balance}.` };
  }
  user.credits = balance - cost;
  await setJSON(`user:${userId}`, user);
  return { ok: true, cost, remaining: user.credits };
}
