// Pure, timezone-agnostic calendar-date math for Bill Guardian. This module
// has no knowledge of any particular user's timezone or of a default zone —
// callers (the cron route, the dashboard UI) must supply the caller's own
// resolved IANA timezone. See lib/profile/timezone.ts for how that timezone
// is resolved per-user, with a migration-era fallback for users who haven't
// set one yet.

export type DateParts = { year: number; month: number; day: number }; // month is 1-indexed

// Matches the existing "upcoming" bucket window used for due-soon bills,
// and doubles as the cutoff for treating a just-passed due date as "next
// month's occurrence is close enough to surface" rather than "overdue".
export const REMINDER_LOOKAHEAD_DAYS = 7;

/**
 * Returns the calendar date (year/month/day) as observed in `timeZone`
 * at the given instant, regardless of the server process's own timezone.
 * `timeZone` must be a valid IANA zone name (e.g. "America/Sao_Paulo",
 * "Europe/London", "Asia/Tokyo") — validate/resolve it before calling.
 */
export function getTodayParts(timeZone: string, reference: Date = new Date()): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Whole-day index since the Unix epoch, computed via Date.UTC so the diff
// between two DateParts is always an exact multiple of 24h (DST-safe —
// this never touches a real timezone's clock, only calendar arithmetic).
function dayIndexUTC(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

// Last valid day of the given month (handles 28/29/30/31-day months,
// including leap-year February), via the "day 0 of next month" trick,
// entirely in UTC so it's unaffected by server-local-time quirks.
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function addMonth(parts: { year: number; month: number }): { year: number; month: number } {
  return parts.month === 12
    ? { year: parts.year + 1, month: 1 }
    : { year: parts.year, month: parts.month + 1 };
}

// Resolves a due_day (1-31) within a specific year/month to a real calendar
// date, clamping to the last valid day of that month when the day doesn't
// exist there (e.g. due_day 31 in a 28-day February => February 28).
function clampedDate(year: number, month1: number, dueDay: number): DateParts {
  return { year, month: month1, day: Math.min(dueDay, daysInMonth(year, month1)) };
}

export type DueOccurrence = DateParts & { dueInDays: number };

/**
 * Resolves the debt's currently-relevant due-date occurrence for a given
 * `dueDay` (1-31) relative to `today`, as a real calendar date (never a
 * raw day-of-month subtraction). Rules:
 *  - If this month's occurrence is today or in the future, use it.
 *  - If this month's occurrence already passed, and next month's
 *    occurrence falls within the reminder lookahead window, surface next
 *    month's occurrence instead (so a bill due the 1st doesn't read as
 *    "30 days overdue" on the 31st when it's really due tomorrow).
 *  - Otherwise, the bill is genuinely overdue for the current cycle —
 *    existing overdue behavior is preserved (negative dueInDays).
 * Out-of-range days (e.g. due_day=31 in a 28-day February) are clamped to
 * the last valid day of the relevant month, not rolled into the next one.
 */
export function resolveDueOccurrence(dueDay: number, today: DateParts): DueOccurrence {
  const todayIndex = dayIndexUTC(today);

  const thisMonth = clampedDate(today.year, today.month, dueDay);
  const thisMonthIndex = dayIndexUTC(thisMonth);

  if (thisMonthIndex >= todayIndex) {
    return { ...thisMonth, dueInDays: thisMonthIndex - todayIndex };
  }

  const next = addMonth(today);
  const nextMonth = clampedDate(next.year, next.month, dueDay);
  const nextMonthIndex = dayIndexUTC(nextMonth);
  const daysUntilNext = nextMonthIndex - todayIndex;

  if (daysUntilNext <= REMINDER_LOOKAHEAD_DAYS) {
    return { ...nextMonth, dueInDays: daysUntilNext };
  }

  return { ...thisMonth, dueInDays: thisMonthIndex - todayIndex };
}
