// Validation/normalization for the "payment source" display metadata on a
// debt (Part 2). This is display metadata only — a nickname for which
// account/card a bill is paid from — never a real account, routing, debit,
// or credit card number. The name field rejects anything containing more
// than 4 numeric digits in total so a pasted card/account/routing number
// can't slip in disguised as a "name"; callers must put the real last four
// digits in the separate `payment_source_last4` field instead.
import type { PaymentSourceType } from "./types";

const VALID_PAYMENT_SOURCE_TYPES: readonly PaymentSourceType[] = [
  "bank_account",
  "credit_card",
  "other",
];

const MAX_NAME_LENGTH = 80;
const MAX_NAME_DIGITS = 4;
const LAST4_PATTERN = /^\d{4}$/;

const NAME_TOO_MANY_DIGITS_ERROR =
  "Enter only the account or card name here. Put the last four digits in the separate field.";
const LAST4_INVALID_ERROR = "Last four digits must be exactly 4 numbers.";
const LAST4_ORPHANED_ERROR =
  "Add an account or card name before entering the last four digits.";

export type NormalizedField = { value: string | null; error?: string };

export function normalizePaymentSourceType(value: unknown): PaymentSourceType | null {
  if (typeof value !== "string") return null;
  return (VALID_PAYMENT_SOURCE_TYPES as readonly string[]).includes(value)
    ? (value as PaymentSourceType)
    : null;
}

// Returns the trimmed name (capped at 80 chars) when valid, or `{ error }`
// when the name carries more than 4 numeric digits — the shape of a full
// account, routing, or card number pasted in rather than a nickname.
export function normalizePaymentSourceName(value: unknown): NormalizedField {
  if (typeof value !== "string") return { value: null };
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  if (trimmed.length === 0) return { value: null };

  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  if (digitCount > MAX_NAME_DIGITS) {
    return { value: null, error: NAME_TOO_MANY_DIGITS_ERROR };
  }

  return { value: trimmed };
}

// Returns the trimmed 4-digit string when valid, or `{ error }` when a
// non-empty value was supplied that isn't exactly four numeric digits.
// Distinguishing "absent" from "invalid" lets callers block a save on a
// typo instead of silently discarding it.
export function normalizePaymentSourceLast4(value: unknown): NormalizedField {
  if (typeof value !== "string" || value.trim() === "") {
    return { value: null };
  }
  const trimmed = value.trim();
  if (!LAST4_PATTERN.test(trimmed)) {
    return { value: null, error: LAST4_INVALID_ERROR };
  }
  return { value: trimmed };
}

// Cross-field rule: a last4 value is orphaned, ambiguous display metadata
// without a name to attach it to. Call after normalizing both fields.
export function validatePaymentSourcePair(
  name: string | null,
  last4: string | null
): string | null {
  if (last4 && !name) {
    return LAST4_ORPHANED_ERROR;
  }
  return null;
}

// Formats a saved payment source for display (bill cards, reminder emails):
// "Name •••• 1234", "Name" alone, or null when there's nothing to show.
// Re-validates last4 independently of storage — a stored value that isn't
// exactly four digits (a corrupted row, a legacy write) is silently dropped
// rather than rendered, so a bad value can never leak more than intended.
export function formatPaymentSourceDisplay(
  name: string | null | undefined,
  last4: string | null | undefined
): string | null {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;

  const validLast4 = last4 && LAST4_PATTERN.test(last4) ? last4 : null;
  return validLast4 ? `${trimmedName} •••• ${validLast4}` : trimmedName;
}
