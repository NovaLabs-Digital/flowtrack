// Shared types for the one-time "launch cohort" email campaign (welcome,
// story, routine, checkin). Mirrors public.launch_cohort_emails
// (lib/security/migration_launch_cohort.sql) field-for-field. Deliberately
// separate from lib/lifecycle-emails/types.ts — this campaign is scheduled
// from a single campaign start time, not each user's own signup date, and
// must never share state, tables, or types with the ongoing signup
// lifecycle sequence.

export type LaunchCohortEmailType = "welcome" | "story" | "routine" | "checkin";

export const LAUNCH_COHORT_EMAIL_TYPES: readonly LaunchCohortEmailType[] = [
  "welcome",
  "story",
  "routine",
  "checkin",
];

export type LaunchCohortEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "suppressed"
  | "exhausted";

export type LaunchCohortEmailRow = {
  id: string;
  user_id: string;
  email_type: LaunchCohortEmailType;
  status: LaunchCohortEmailStatus;
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

// Returned by the public.claim_launch_cohort_email(...) RPC — a narrow
// subset of the row, just enough to build and send the email and to later
// call complete_launch_cohort_email with the matching claim token.
export type ClaimedLaunchCohortEmail = {
  id: string;
  user_id: string;
  email_type: LaunchCohortEmailType;
  claim_token: string;
};

export type LaunchCohortMemberRow = {
  user_id: string;
  enrolled_at: string;
  enrolled_by: string;
  suppressed_at: string | null;
  suppression_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SendOutcome = "sent" | "failed" | "exhausted";

// Per-run summary counters for the cron route. Every field is a count,
// never a recipient, name, or token.
export type LaunchCohortRunSummary = {
  discovered: number;
  eligible: number;
  claimed: number;
  sent: number;
  skipped: number;
  suppressed: number;
  failed: number;
  exhausted: number;
};

export function emptyLaunchCohortRunSummary(): LaunchCohortRunSummary {
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
