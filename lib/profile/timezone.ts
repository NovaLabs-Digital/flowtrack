// Migration-era fallback ONLY: applied when a user has no stored timezone
// preference yet (or an unrecognized value slipped in some other way).
// This is not the application's reminder-logic default — every Bill
// Guardian calculation uses the user's own resolved timezone; this constant
// exists solely so pre-migration users don't crash or silently go without
// reminders before they've had a chance to set a real preference.
export const DEFAULT_TIME_ZONE = "America/New_York";

/**
 * Resolves a user's stored timezone preference to a valid IANA zone name,
 * falling back to DEFAULT_TIME_ZONE when the value is missing or invalid.
 */
export function resolveTimeZone(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_TIME_ZONE;
  try {
    // Throws RangeError for an unrecognized IANA zone identifier.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
