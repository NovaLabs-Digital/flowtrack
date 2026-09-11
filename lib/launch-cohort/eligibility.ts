// Pure eligibility/timing logic for the one-time launch cohort email
// campaign. Kept free of any Supabase/Resend import so it can be
// unit-tested directly (see eligibility.test.ts) rather than only through
// source-content assertions. Deliberately independent of
// lib/lifecycle-emails/eligibility.ts — same proven shape (fail-closed
// rollout cutoff, bounded retry backoff, row-id-only idempotency key), but
// its own constants and env var, so this campaign can never be affected by
// (or accidentally affect) the signup lifecycle sequence's behavior.

import type { LaunchCohortEmailType } from "./types";

// Env var name is intentionally exported as a named constant (not just a
// string literal scattered across call sites) so the migration/runbook
// docs and the route/service code can all reference the exact same name.
// Distinct from SIGNUP_EMAILS_START_AT_ENV on purpose: this campaign is
// scheduled from one explicit campaign start time, never from any
// individual user's own signup date.
export const LAUNCH_COHORT_START_AT_ENV = "LAUNCH_COHORT_START_AT";

/**
 * Parses LAUNCH_COHORT_START_AT as an ISO-8601 timestamp. Returns null for
 * anything missing, empty, or unparseable — callers MUST treat null as
 * "fail closed: send nothing, enroll nothing", never default to the epoch,
 * deploy time, or the current time. This function never falls back to a
 * default itself. A deploy therefore sends zero launch-cohort emails by
 * default: nothing sends until this env var is explicitly set in
 * Production.
 */
export function parseLaunchCohortStartAt(
  raw: string | undefined | null
): Date | null {
  if (!raw || raw.trim() === "") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The point in time each email type becomes eligible, anchored to the
 * single explicit campaign start time — never any individual user's own
 * signup/enrollment date. This is the defining difference from the signup
 * lifecycle sequence: every enrolled member's day-0 email becomes eligible
 * at the same instant, regardless of when they were enrolled or when their
 * account was created.
 */
export function computeEligibleAt(
  emailType: LaunchCohortEmailType,
  campaignStart: Date
): Date {
  switch (emailType) {
    case "welcome":
      return new Date(campaignStart.getTime());
    case "story":
      return new Date(campaignStart.getTime() + 7 * DAY_MS);
    case "routine":
      return new Date(campaignStart.getTime() + 14 * DAY_MS);
    case "checkin":
      return new Date(campaignStart.getTime() + 21 * DAY_MS);
  }
}

// Bounded retry policy: an initial attempt plus three retries, with
// increasing backoff, then the row is marked "exhausted" and never
// reattempted automatically. Deliberately its own constants (not imported
// from lib/lifecycle-emails/eligibility.ts) so the two campaigns' retry
// behavior can never be coupled.
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
 * The single, centralized definition of a launch-cohort email's provider
 * idempotency key — derived ONLY from the immutable launch_cohort_emails
 * row id, exactly mirroring
 * lib/lifecycle-emails/eligibility.ts:buildLifecycleEmailIdempotencyKey's
 * own reasoning (never claim_token, which changes on every retry/reclaim
 * and would defeat idempotency entirely). Uses a distinct key prefix
 * ("flowtrack-launch-cohort/" vs "flowtrack-lifecycle-email/") so the two
 * campaigns' provider-side idempotency records can never collide even if a
 * row id were ever reused across tables.
 *
 * Resend stores idempotency keys for 24 hours from first use
 * (https://resend.com/docs/dashboard/emails/idempotency-keys) — not
 * indefinitely. See lib/security/launch_cohort_runbook.sql for what that
 * does and does not guarantee once a retry falls outside that window.
 */
export function buildLaunchCohortEmailIdempotencyKey(launchCohortEmailId: string): string {
  return `flowtrack-launch-cohort/${launchCohortEmailId}`;
}
