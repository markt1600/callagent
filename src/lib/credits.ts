// Account credits. Every outbound call costs credits, priced by destination
// country prefix (editable in Admin). New accounts start with a fixed grant;
// each call attempt deducts its cost before dialing. Guest-mode reservations
// have no account and are not charged.

import { getJSON, setJSON } from "./store";
import type { CreditTransaction, UserProfile } from "./types";

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

/** Append an entry to the user's credit ledger. */
async function recordTransaction(
  userId: string,
  delta: number,
  balanceAfter: number,
  description: string,
): Promise<void> {
  // Inverted-timestamp key so lexicographic listing is newest-first-friendly.
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tx: CreditTransaction = {
    id,
    userId,
    at: new Date().toISOString(),
    delta,
    balanceAfter,
    description,
  };
  await setJSON(`credtx:${userId}:${id}`, tx);
}

/** Record the initial grant in the ledger (called once, on first login). */
export async function recordWelcomeGrant(userId: string): Promise<void> {
  await recordTransaction(userId, STARTING_CREDITS, STARTING_CREDITS, "Welcome credits");
}

/** Add credits to an account (future top-up feature; usable from admin). */
export async function grantCredits(
  userId: string,
  amount: number,
  description: string,
): Promise<number | null> {
  const user = await getJSON<UserProfile>(`user:${userId}`);
  if (!user || !Number.isFinite(amount) || amount <= 0) return null;
  user.credits = creditsOf(user) + Math.round(amount);
  await setJSON(`user:${userId}`, user);
  await recordTransaction(userId, Math.round(amount), user.credits, description);
  return user.credits;
}

/**
 * Deduct the cost of one call to `phoneNumber` from the user's balance.
 * Fails (without deducting) when the balance can't cover it. Every
 * deduction is recorded in the user's credit ledger.
 */
export async function chargeForCall(
  userId: string,
  phoneNumber: string,
  reason = "Call",
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
  await recordTransaction(userId, -cost, user.credits, `${reason} (${phoneNumber})`);
  return { ok: true, cost, remaining: user.credits };
}
