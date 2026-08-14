// Calling-hours policy, destination-aware.
//
// Default window: 12:00–19:00 local time.
// Japan (+81): restaurants strongly dislike reservation calls during service
// rush (roughly 12:00–13:30 and 18:00–20:00), and the quiet stretch between
// services is the customary time to call — so the Japanese window is
// 13:30–18:00, and scheduled/snapped calls land at 14:00.
//
// When "now" is outside the window, the call is scheduled for the next
// opening — same day if possible, otherwise the next weekday.

interface CallWindow {
  /** window opens (minutes after local midnight) */
  startMin: number;
  /** window closes (minutes after local midnight) */
  endMin: number;
  /** where snapped/scheduled calls land (minutes after local midnight) */
  snapMin: number;
}

const DEFAULT_WINDOW: CallWindow = { startMin: 12 * 60, endMin: 19 * 60, snapMin: 12 * 60 };

const WINDOWS_BY_PREFIX: [string, CallWindow][] = [
  // Japan: avoid lunch rush (till ~13:30) and dinner service (from 18:00).
  ["+81", { startMin: 13 * 60 + 30, endMin: 18 * 60, snapMin: 14 * 60 }],
];

function windowFor(phoneNumber: string): CallWindow {
  for (const [prefix, w] of WINDOWS_BY_PREFIX) {
    if (phoneNumber.startsWith(prefix)) return w;
  }
  return DEFAULT_WINDOW;
}

/** UTC offset (hours) inferred from the destination country code. */
const TZ_OFFSETS: [string, number][] = [
  ["+81", 9], // Japan
  ["+82", 9], // South Korea
  ["+65", 8], // Singapore
  ["+886", 8],
  ["+852", 8],
  ["+63", 8],
  ["+66", 7], // Thailand
  ["+84", 7], // Vietnam
  ["+61", 10],
  ["+64", 12],
  ["+91", 5.5],
  ["+49", 1], // Germany
  ["+33", 1], // France
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
const MIN_MS = 60_000;

/** True if `date` falls inside the destination's calling window. */
export function isWithinCallWindow(date: Date, phoneNumber: string): boolean {
  const offset = tzOffsetHours(phoneNumber);
  const w = windowFor(phoneNumber);
  const local = new Date(date.getTime() + offset * HOUR_MS);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes >= w.startMin && minutes < w.endMin;
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
  const w = windowFor(phoneNumber);
  const startLocalDay = Math.floor((from.getTime() + offsetMs) / DAY_MS);

  let t = new Date(from.getTime() + minDelayMinutes * MIN_MS);
  for (let i = 0; i < 20; i++) {
    const localMs = t.getTime() + offsetMs;
    const localDay = Math.floor(localMs / DAY_MS);
    const local = new Date(localMs);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const dow = local.getUTCDay(); // 0=Sun, 6=Sat
    const isSameDayAsRequest = localDay === startLocalDay;

    // Rolled to a later day that's a weekend: advance to the next day.
    if (!isSameDayAsRequest && (dow === 0 || dow === 6)) {
      t = new Date((localDay + 1) * DAY_MS + w.snapMin * MIN_MS - offsetMs);
      continue;
    }
    // Before the window opens: snap into the window that day.
    if (minutes < w.startMin) {
      t = new Date(localDay * DAY_MS + w.snapMin * MIN_MS - offsetMs);
      continue;
    }
    // Past the window: next day at the snap time.
    if (minutes >= w.endMin) {
      t = new Date((localDay + 1) * DAY_MS + w.snapMin * MIN_MS - offsetMs);
      continue;
    }
    return t;
  }
  return t; // unreachable in practice
}
