// Calling-hours policy: calls are only placed between 12:00 and 19:00 in the
// destination's local time. When "now" is outside the window, the call is
// scheduled for the next opening — same day if possible, otherwise the next
// weekday at noon.

const WINDOW_START_HOUR = 12;
const WINDOW_END_HOUR = 19;

/** UTC offset (hours) inferred from the destination country code. */
const TZ_OFFSETS: [string, number][] = [
  ["+81", 9], // Japan
  ["+65", 8], // Singapore
  ["+886", 8],
  ["+852", 8],
  ["+63", 8],
  ["+61", 10],
  ["+64", 12],
  ["+91", 5.5],
  ["+44", 0],
  ["+1", -5],
];

export function tzOffsetHours(phoneNumber: string): number {
  for (const [prefix, offset] of TZ_OFFSETS) {
    if (phoneNumber.startsWith(prefix)) return offset;
  }
  return 8; // sensible default for this app's region (SGT)
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** True if `date` falls inside the 12:00–19:00 window, destination-local. */
export function isWithinCallWindow(date: Date, phoneNumber: string): boolean {
  const offset = tzOffsetHours(phoneNumber);
  const local = new Date(date.getTime() + offset * HOUR_MS);
  const h = local.getUTCHours();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

/**
 * Next moment (>= from + minDelayMinutes) at which calling is allowed.
 * Same-local-day slots are always acceptable; once we roll to a later day,
 * only weekdays (Mon–Fri) qualify.
 */
export function nextCallWindowTime(
  from: Date,
  phoneNumber: string,
  minDelayMinutes = 0,
): Date {
  const offset = tzOffsetHours(phoneNumber);
  const offsetMs = offset * HOUR_MS;
  const startLocalDay = Math.floor((from.getTime() + offsetMs) / DAY_MS);

  let t = new Date(from.getTime() + minDelayMinutes * 60_000);
  for (let i = 0; i < 20; i++) {
    const localMs = t.getTime() + offsetMs;
    const localDay = Math.floor(localMs / DAY_MS);
    const local = new Date(localMs);
    const hour = local.getUTCHours();
    const dow = local.getUTCDay(); // 0=Sun, 6=Sat
    const isSameDayAsRequest = localDay === startLocalDay;

    // Rolled to a later day that's a weekend: advance to the next day at noon.
    if (!isSameDayAsRequest && (dow === 0 || dow === 6)) {
      t = new Date((localDay + 1) * DAY_MS + WINDOW_START_HOUR * HOUR_MS - offsetMs);
      continue;
    }
    // Before the window opens: snap to noon (local) that day.
    if (hour < WINDOW_START_HOUR) {
      t = new Date(localDay * DAY_MS + WINDOW_START_HOUR * HOUR_MS - offsetMs);
      continue;
    }
    // Past the window: next day at noon.
    if (hour >= WINDOW_END_HOUR) {
      t = new Date((localDay + 1) * DAY_MS + WINDOW_START_HOUR * HOUR_MS - offsetMs);
      continue;
    }
    return t;
  }
  return t; // unreachable in practice
}
