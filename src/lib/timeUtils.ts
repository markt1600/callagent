/** Shift an "HH:MM" time by `deltaMinutes`, clamped to the same day. */
export function shiftHHMM(hhmm: string, deltaMinutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  let total = Number(match[1]) * 60 + Number(match[2]) + deltaMinutes;
  total = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}
