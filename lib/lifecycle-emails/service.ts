// Shared lifecycle-email service used by both the immediate-welcome
// endpoint (app/api/lifecycle-emails/welcome/route.ts) and the cron route
// (app/api/cron/signup-emails/route.ts) — one code path, so "the browser
// closed" and "the cron discovers it later" can never diverge in behavior.
//
// Every write to public.lifecycle_emails goes through the two
// service_role-only RPCs defined in
// lib/security/migration_lifecycle_emails.sql (claim_lifecycle_email,
// complete_lifecycle_email) — this file never issues a raw
// .update()/.insert() against a claimed row's state columns, so the
// atomic-claim guarantee lives in exactly one place.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  sendEmail,
  buildWelcomeEmail,
  buildFeedback48hEmail,
  buildCheckin7dEmail,
} from "../daily-companion";
import {
  computeEligibleAt,
  computeNextAttempt,
  isEligibleByCutoff,
  parseSignupEmailsStartAt,
  buildLifecycleEmailIdempotencyKey,
  CLAIM_LEASE_SECONDS,
  SIGNUP_EMAILS_START_AT_ENV,
} from "./eligibility";
import {
  LIFECYCLE_EMAIL_TYPES,
  type ClaimedLifecycleEmail,
  type LifecycleEmailRow,
  type LifecycleEmailType,
  type SendOutcome,
} from "./types";

export type EligibleUser = {
  id: string;
  email: string;
  fullName: string | null;
  confirmedAt: Date;
  createdAt: Date;
};

/**
 * Resolves a Supabase auth User into the shape this service needs, or null
 * if the user isn't eligible at all (no confirmed email — this is the one
 * hard gate that applies to every lifecycle email type). Never trusts a
 * client-submitted email/id: callers must have obtained `user` from a
 * server-verified source (admin.getUserById, admin.listUsers, or
 * auth.getUser(token) against a bearer token that was itself verified).
 */
export function toEligibleUser(user: User): EligibleUser | null {
  if (!user.email || !user.email_confirmed_at) return null;
  const fullName =
    typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : null;
  return {
    id: user.id,
    email: user.email,
    fullName,
    confirmedAt: new Date(user.email_confirmed_at),
    createdAt: new Date(user.created_at),
  };
}

/**
 * Idempotently ensures a pending row exists for every lifecycle email type
 * for this user, applying the rollout cutoff. Safe to call repeatedly
 * (relies on UNIQUE(user_id, email_type) + ignoreDuplicates — a duplicate
 * insert attempt is a silent no-op, never an error surfaced to the
 * caller). Returns the number of rows actually created (0 on a pure
 * idempotent replay).
 *
 * cutoff = null means "fail closed": creates nothing and returns 0. This
 * is what makes a missing/invalid SIGNUP_EMAILS_START_AT stop all sending
 * outright, per the mandatory rollout-cutoff requirement.
 */
export async function ensureLifecycleRows(
  supabaseAdmin: SupabaseClient,
  user: EligibleUser,
  cutoff: Date | null
): Promise<{ created: number }> {
  if (!isEligibleByCutoff(user.createdAt, cutoff)) {
    return { created: 0 };
  }

  const rows = LIFECYCLE_EMAIL_TYPES.map((emailType) => ({
    user_id: user.id,
    email_type: emailType,
    eligible_at: computeEligibleAt(emailType, user.confirmedAt).toISOString(),
  }));

  const { data, error } = await supabaseAdmin
    .from("lifecycle_emails")
    .upsert(rows, { onConflict: "user_id,email_type", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw new Error(`ensureLifecycleRows: upsert failed: ${error.message}`);
  }

  return { created: data?.length ?? 0 };
}

/**
 * True only if this user's 'welcome' row has status = 'sent'. feedback_48h
 * and checkin_7d must never be attempted before this is true, regardless
 * of how much time has passed — per the explicit welcome-is-a-prerequisite
 * requirement.
 */
export async function hasWelcomeBeenSent(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("status")
    .eq("user_id", userId)
    .eq("email_type", "welcome")
    .maybeSingle();

  if (error || !data) return false;
  return data.status === "sent";
}

export type CandidateRow = { id: string; user_id: string; email_type: LifecycleEmailType };

/**
 * Finds rows that are at least superficially due (not yet terminal, and
 * eligible_at has passed) — a plain SELECT, not a claim. The actual claim
 * (and its atomicity) happens per-row in claimAndSend below. Deliberately
 * over-fetches slightly (feedback_48h/checkin_7d rows whose welcome
 * prerequisite hasn't been met yet) — that check happens per-row in
 * claimAndSend, not here, to keep this query simple and the eligibility
 * logic in one place.
 */
export async function findCandidateRows(
  supabaseAdmin: SupabaseClient,
  options: { userId?: string; limit?: number } = {}
): Promise<CandidateRow[]> {
  let query = supabaseAdmin
    .from("lifecycle_emails")
    .select("id, user_id, email_type")
    .in("status", ["pending", "failed", "processing"])
    .lte("eligible_at", new Date().toISOString())
    .limit(options.limit ?? 200);

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`findCandidateRows: query failed: ${error.message}`);
  }
  return (data ?? []) as CandidateRow[];
}

/**
 * The number of rows currently in status = 'suppressed', within scope
 * (every user normally, or exactly one user when userId is given). This is
 * an observability snapshot taken fresh on every call — identical whether
 * the caller is doing a dry run or a real run, since it is a plain read
 * and never mutates anything. It does NOT count rows suppressed "during
 * this run": nothing in the send pipeline (claimAndSend below) ever
 * suppresses a row itself — suppression only ever happens out-of-band, via
 * the manual STOP procedure (suppressUpcomingLifecycleEmails below / the
 * runbook's "Manual STOP suppression" appendix) — so this is deliberately
 * "how many suppressed rows exist in scope right now", not "how many were
 * suppressed just now".
 */
export async function countSuppressedRows(
  supabaseAdmin: SupabaseClient,
  options: { userId?: string } = {}
): Promise<number> {
  let query = supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("status", "suppressed");

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`countSuppressedRows: query failed: ${error.message}`);
  }
  return count ?? 0;
}

export type SendAttemptResult =
  | { outcome: "sent"; providerMessageId: string | null }
  | { outcome: "failed"; willRetryAt: Date | null }
  | { outcome: "exhausted" }
  | { outcome: "skipped"; reason: "not_claimed" | "welcome_prerequisite_not_met" | "user_not_confirmed" | "cutoff" };
// No "suppressed" outcome here: claimAndSend never suppresses a row itself
// (findCandidateRows and claim_lifecycle_email's own WHERE clause both
// already exclude status = 'suppressed' rows from ever being claimed), so
// that branch was dead code that could only ever contribute a misleading,
// permanently-zero count. See countSuppressedRows above for the real,
// scope-aware way this is now surfaced.

/**
 * The full claim -> (eligibility re-check) -> build -> send -> complete
 * pipeline for exactly one row, shared by the cron route and (indirectly,
 * for the welcome type only) the immediate endpoint. Never sends without
 * first successfully claiming the row via the atomic RPC.
 */
export async function claimAndSend(
  supabaseAdmin: SupabaseClient,
  candidate: CandidateRow,
  options: { dryRun?: boolean } = {}
): Promise<SendAttemptResult> {
  if (options.dryRun) {
    return { outcome: "skipped", reason: "not_claimed" };
  }

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
    "claim_lifecycle_email",
    { p_id: candidate.id, p_lease_seconds: CLAIM_LEASE_SECONDS }
  );

  if (claimError || !claimed || claimed.length === 0) {
    // Not an error condition by itself — most commonly means another
    // worker already claimed it, or it isn't due yet after all.
    return { outcome: "skipped", reason: "not_claimed" };
  }

  const claim = claimed[0] as ClaimedLifecycleEmail;

  // feedback_48h / checkin_7d must never send before welcome has actually
  // been sent — re-checked here, at claim time, using live state.
  if (claim.email_type !== "welcome") {
    const welcomeSent = await hasWelcomeBeenSent(supabaseAdmin, claim.user_id);
    if (!welcomeSent) {
      await supabaseAdmin.rpc("complete_lifecycle_email", {
        p_id: claim.id,
        p_claim_token: claim.claim_token,
        p_status: "failed",
        p_last_error: "welcome_prerequisite_not_met",
        p_next_attempt_at: computeNextAttempt(1, new Date())?.toISOString() ?? null,
      });
      return { outcome: "skipped", reason: "welcome_prerequisite_not_met" };
    }
  }

  // Resolve the recipient and confirmation state server-side, live, right
  // before sending — never trust any previously-stored email/name.
  const { data: userLookup, error: userLookupError } = await supabaseAdmin.auth.admin.getUserById(
    claim.user_id
  );
  const eligibleUser = userLookup?.user ? toEligibleUser(userLookup.user) : null;

  if (userLookupError || !eligibleUser) {
    return await failClaim(supabaseAdmin, claim, "user_lookup_failed_or_unconfirmed");
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.appflowtrack.com"}/dashboard`;
  const displayName = eligibleUser.fullName ?? eligibleUser.email;
  const generatedAt = new Date().toISOString();

  const builtEmail =
    claim.email_type === "welcome"
      ? buildWelcomeEmail({ userName: displayName, userEmail: eligibleUser.email, emailType: "welcome", dashboardUrl, generatedAt })
      : claim.email_type === "feedback_48h"
      ? buildFeedback48hEmail({ userName: displayName, userEmail: eligibleUser.email, emailType: "feedback_48h", generatedAt })
      : buildCheckin7dEmail({ userName: displayName, userEmail: eligibleUser.email, emailType: "checkin_7d", generatedAt });

  // Stable per-ROW idempotency key — deliberately derived from claim.id
  // alone, never claim.claim_token (which changes on every retry/reclaim
  // and would defeat idempotency entirely if included; see
  // buildLifecycleEmailIdempotencyKey's own doc comment). Resend
  // recognizes a retried send using this same key as the same logical
  // operation for 24 hours from first use, not indefinitely — see
  // lib/security/lifecycle_emails_runbook.sql for what that does and does
  // not protect against.
  const idempotencyKey = buildLifecycleEmailIdempotencyKey(claim.id);

  const result = await sendEmail(builtEmail, { idempotencyKey });

  if (!result.success) {
    return await failClaim(supabaseAdmin, claim, result.error ?? "send_failed");
  }

  await supabaseAdmin.rpc("complete_lifecycle_email", {
    p_id: claim.id,
    p_claim_token: claim.claim_token,
    p_status: "sent",
    p_provider_message_id: result.id ?? null,
  });

  return { outcome: "sent", providerMessageId: result.id ?? null };
}

async function failClaim(
  supabaseAdmin: SupabaseClient,
  claim: ClaimedLifecycleEmail,
  errorMessage: string
): Promise<SendAttemptResult> {
  // Read the row's current attempt_count (already incremented by the
  // claim itself) to decide whether this failure exhausts the retry
  // budget — computeNextAttempt returns null once it does.
  const { data: row } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("attempt_count")
    .eq("id", claim.id)
    .maybeSingle();

  const attemptCount = (row as { attempt_count: number } | null)?.attempt_count ?? 1;
  // Truncate defensively — last_error is operator-facing diagnostics, not
  // user content, but must never grow unbounded or embed a stray secret
  // from an unexpected error shape.
  const sanitizedError = errorMessage.slice(0, 300);
  const nextAttempt = computeNextAttempt(attemptCount, new Date());

  await supabaseAdmin.rpc("complete_lifecycle_email", {
    p_id: claim.id,
    p_claim_token: claim.claim_token,
    p_status: nextAttempt ? "failed" : "exhausted",
    p_last_error: sanitizedError,
    p_next_attempt_at: nextAttempt ? nextAttempt.toISOString() : null,
  });

  return nextAttempt ? { outcome: "failed", willRetryAt: nextAttempt } : { outcome: "exhausted" };
}

/**
 * Narrow, deliberate STOP suppression: suppresses only feedback_48h/
 * checkin_7d rows that have not already been sent, for exactly the
 * user_id passed in — never resolved by email, so it cannot ambiguously
 * affect the wrong account. See lib/security/lifecycle_emails_runbook.sql
 * ("Manual STOP suppression") for the current manual invocation path.
 */
export async function suppressUpcomingLifecycleEmails(
  supabaseAdmin: SupabaseClient,
  userId: string,
  reason: string
): Promise<{ suppressed: number }> {
  const { data, error } = await supabaseAdmin
    .from("lifecycle_emails")
    .update({ status: "suppressed", suppressed_at: new Date().toISOString(), suppression_reason: reason })
    .eq("user_id", userId)
    .in("email_type", ["feedback_48h", "checkin_7d"])
    .not("status", "in", "(sent,suppressed)")
    .select("id");

  if (error) {
    throw new Error(`suppressUpcomingLifecycleEmails: update failed: ${error.message}`);
  }

  return { suppressed: data?.length ?? 0 };
}

export { parseSignupEmailsStartAt, SIGNUP_EMAILS_START_AT_ENV };
export type { CandidateRow as LifecycleCandidateRow, SendOutcome };
export type { LifecycleEmailRow };
