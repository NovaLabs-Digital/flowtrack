// Pure eligibility/timing logic for the signup lifecycle email sequence.
// Kept free of any Supabase/Resend import so it can be unit-tested directly
// (see eligibility.test.ts) rather than only through source-content
// assertions.

import type { LifecycleEmailType } from "./types";

// Env var name is intentionally exported as a named constant (not just a
// string literal scattered across call sites) so the migration/runbook
// docs and the route/service code can all reference the exact same name.
export const SIGNUP_EMAILS_START_AT_ENV = "SIGNUP_EMAILS_START_AT";

/**
 * Parses SIGNUP_EMAILS_START_AT as an ISO-8601 timestamp. Returns null for
 * anything missing, empty, or unparseable — callers MUST treat null as
 * "fail closed: send nothing", never default to the epoch, deploy time, or
 * the current time. This function never falls back to a default itself.
 */
export function parseSignupEmailsStartAt(
  raw: string | undefined | null
): Date | null {
  if (!raw || raw.trim() === "") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * True only when the account's creation time is on or after the rollout
 * cutoff. A null cutoff (missing/invalid env var) always returns false —
 * the fail-closed behavior lives here, once, rather than being re-derived
 * at each call site.
 */
export function isEligibleByCutoff(
  accountCreatedAt: Date,
  cutoff: Date | null
): boolean {
  if (cutoff === null) return false;
  return accountCreatedAt.getTime() >= cutoff.getTime();
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The point in time each email type becomes eligible, anchored to the
 * confirmed-signup timestamp (auth.users.email_confirmed_at) — never the
 * raw account-creation time, since an unconfirmed signup must never
 * receive any lifecycle email.
 */
export function computeEligibleAt(
  emailType: LifecycleEmailType,
  confirmedAt: Date
): Date {
  switch (emailType) {
    case "welcome":
      return new Date(confirmedAt.getTime());
    case "feedback_48h":
      return new Date(confirmedAt.getTime() + 48 * HOUR_MS);
    case "checkin_7d":
      return new Date(confirmedAt.getTime() + 7 * 24 * HOUR_MS);
  }
}

// Bounded retry policy: an initial attempt plus three retries, with
// increasing backoff, then the row is marked "exhausted" and never
// reattempted automatically. Minutes, not a cron-frequency assumption —
// whatever cadence the cron actually runs at, a row simply isn't reclaimed
// again until its own next_attempt_at has passed.
export const MAX_ATTEMPTS = 4;
export const RETRY_BACKOFF_MINUTES: readonly number[] = [15, 60, 360];

/**
 * The next_attempt_at to record after a failed attempt numbered
 * `attemptCount` (1-based: the attempt that just failed). Returns null once
 * attemptCount has reached MAX_ATTEMPTS — callers must treat a null result
 * as "mark exhausted", not "retry immediately" or "retry never".
 */
export function computeNextAttempt(
  attemptCount: number,
  from: Date
): Date | null {
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const stepIndex = Math.min(attemptCount - 1, RETRY_BACKOFF_MINUTES.length - 1);
  const minutes = RETRY_BACKOFF_MINUTES[Math.max(stepIndex, 0)];
  return new Date(from.getTime() + minutes * 60 * 1000);
}

// A claimed-but-never-completed row (worker crashed, request timed out) is
// reclaimable once its lease expires. Deliberately generous relative to a
// single Resend HTTP call's realistic duration, so a slow-but-succeeding
// attempt is never reclaimed out from under itself.
export const CLAIM_LEASE_SECONDS = 120;

/**
 * The single, centralized definition of a lifecycle email's provider
 * idempotency key — derived ONLY from the immutable lifecycle_emails row
 * id. Deliberately does NOT take claim_token: claim_token is a
 * per-attempt database lease/completion credential that changes on every
 * retry and every stale-lease reclaim, and mixing it into the provider key
 * would defeat the whole point of an idempotency key (Resend would then
 * see every retry of the same logical email as a brand-new operation).
 * The immediate-welcome endpoint and the cron route both call this via the
 * single shared claimAndSend() in service.ts, so they can never diverge.
 *
 * Resend stores idempotency keys for 24 hours from first use
 * (https://resend.com/docs/dashboard/emails/idempotency-keys) — not
 * indefinitely. See service.ts's claimAndSend() and
 * lib/security/lifecycle_emails_runbook.sql for what that does and does
 * not guarantee once a retry falls outside that window.
 */
export function buildLifecycleEmailIdempotencyKey(lifecycleEmailId: string): string {
  return `flowtrack-lifecycle-email/${lifecycleEmailId}`;
}
