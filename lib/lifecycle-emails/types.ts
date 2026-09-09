// Shared types for the signup lifecycle email sequence (welcome,
// ~48-hour feedback, 7-day check-in). Mirrors public.lifecycle_emails
// (lib/security/migration_lifecycle_emails.sql) field-for-field.

export type LifecycleEmailType = "welcome" | "feedback_48h" | "checkin_7d";

export const LIFECYCLE_EMAIL_TYPES: readonly LifecycleEmailType[] = [
  "welcome",
  "feedback_48h",
  "checkin_7d",
];

export type LifecycleEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "suppressed"
  | "exhausted";

export type LifecycleEmailRow = {
  id: string;
  user_id: string;
  email_type: LifecycleEmailType;
  status: LifecycleEmailStatus;
  eligible_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  locked_until: string | null;
  claim_token: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  suppressed_at: string | null;
  suppression_reason: string | null;
  created_at: string;
  updated_at: string;
};

// Returned by the public.claim_lifecycle_email(...) RPC — a narrow subset
// of the row, just enough to build and send the email and to later call
// complete_lifecycle_email with the matching claim token.
export type ClaimedLifecycleEmail = {
  id: string;
  user_id: string;
  email_type: LifecycleEmailType;
  claim_token: string;
};

export type SendOutcome = "sent" | "failed" | "exhausted";

// Per-run summary counters for the cron route and, informally, the
// immediate-welcome endpoint's internal logging. Every field is a count,
// never a recipient, name, or token.
export type LifecycleEmailRunSummary = {
  discovered: number;
  eligible: number;
  claimed: number;
  sent: number;
  skipped: number;
  suppressed: number;
  failed: number;
  exhausted: number;
};

export function emptyRunSummary(): LifecycleEmailRunSummary {
  return {
    discovered: 0,
    eligible: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    suppressed: 0,
    failed: 0,
    exhausted: 0,
  };
}
