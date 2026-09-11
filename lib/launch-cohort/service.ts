// Shared launch-cohort campaign service used by the dedicated cron route
// (app/api/cron/launch-cohort-emails/route.ts). There is no immediate
// endpoint for this campaign — enrollment is exclusively the manual,
// out-of-band Step 4 of lib/security/launch_cohort_runbook.sql, so there is
// no "user just did something" trigger to react to, only the cron's
// periodic discovery of due, already-enrolled rows.
//
// Every write to public.launch_cohort_emails that changes claim/completion
// state goes through the two service_role-only RPCs defined in
// lib/security/migration_launch_cohort.sql (claim_launch_cohort_email,
// complete_launch_cohort_email) — this file never issues a raw
// .update()/.insert() against a claimed row's state columns, so the
// atomic-claim guarantee lives in exactly one place. Row *creation*
// (ensureLaunchCohortRows) and suppression are direct table writes, exactly
// mirroring lib/lifecycle-emails/service.ts's own division of
// responsibility.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  sendEmail,
  buildLaunchCohortWelcomeEmail,
  buildLaunchCohortStoryEmail,
  buildLaunchCohortRoutineEmail,
  buildLaunchCohortCheckinEmail,
} from "../daily-companion";
import {
  computeEligibleAt,
  computeNextAttempt,
  buildLaunchCohortEmailIdempotencyKey,
  CLAIM_LEASE_SECONDS,
  parseLaunchCohortStartAt,
  LAUNCH_COHORT_START_AT_ENV,
} from "./eligibility";
import {
  LAUNCH_COHORT_EMAIL_TYPES,
  type ClaimedLaunchCohortEmail,
  type LaunchCohortEmailType,
} from "./types";

export type EligibleMember = {
  id: string;
  email: string;
  fullName: string | null;
};

/**
 * Resolves a Supabase auth User into the shape this service needs, or null
 * if the user isn't eligible at all (no confirmed email). Never trusts a
 * client-submitted email/id: callers must have obtained `user` from a
 * server-verified source (admin.getUserById). There is no "account created
 * after X" gate here, unlike the signup lifecycle sequence — eligibility
 * for this campaign is determined entirely by explicit roster enrollment
 * (public.launch_cohort_members), not by account age.
 */
export function toEligibleMember(user: User): EligibleMember | null {
  if (!user.email || !user.email_confirmed_at) return null;
  const fullName =
    typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : null;
  return { id: user.id, email: user.email, fullName };
}

export type ActiveMember = { userId: string };

/**
 * Reads the not-suppressed rows of the manually-curated roster
 * (public.launch_cohort_members) — a plain SELECT, scope-narrowed to
 * exactly one user_id when provided (single-user test mode). This table
 * has no application INSERT grant (see migration_launch_cohort.sql), so
 * this function can only ever discover users Alberto explicitly enrolled
 * via the runbook; the application can never grow this set itself.
 */
export async function findActiveMembers(
  supabaseAdmin: SupabaseClient,
  options: { userId?: string } = {}
): Promise<ActiveMember[]> {
  let query = supabaseAdmin
    .from("launch_cohort_members")
    .select("user_id")
    .is("suppressed_at", null);

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`findActiveMembers: query failed: ${error.message}`);
  }
  return ((data ?? []) as { user_id: string }[]).map((row) => ({ userId: row.user_id }));
}

/**
 * Idempotently ensures a pending row exists for every launch-cohort email
 * type for this member, all four anchored to the single explicit campaign
 * start time. Safe to call repeatedly (relies on
 * UNIQUE(user_id, email_type) + ignoreDuplicates — a duplicate insert
 * attempt is a silent no-op). Returns the number of rows actually created.
 *
 * campaignStart = null means "fail closed": creates nothing and returns 0.
 * This is what makes a missing/invalid LAUNCH_COHORT_START_AT stop all
 * sending outright — the mandatory rollout-configuration requirement.
 */
export async function ensureLaunchCohortRows(
  supabaseAdmin: SupabaseClient,
  member: EligibleMember,
  campaignStart: Date | null
): Promise<{ created: number }> {
  if (campaignStart === null) {
    return { created: 0 };
  }

  const rows = LAUNCH_COHORT_EMAIL_TYPES.map((emailType) => ({
    user_id: member.id,
    email_type: emailType,
    eligible_at: computeEligibleAt(emailType, campaignStart).toISOString(),
  }));

  const { data, error } = await supabaseAdmin
    .from("launch_cohort_emails")
    .upsert(rows, { onConflict: "user_id,email_type", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw new Error(`ensureLaunchCohortRows: upsert failed: ${error.message}`);
  }

  return { created: data?.length ?? 0 };
}

/**
 * True only if this user's 'welcome' row has status = 'sent'. story/
 * routine/checkin must never be attempted before this is true, regardless
 * of how much time has passed since the campaign start — mirrors the
 * signup lifecycle sequence's own welcome-is-a-prerequisite rule exactly.
 */
export async function hasWelcomeBeenSent(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("launch_cohort_emails")
    .select("status")
    .eq("user_id", userId)
    .eq("email_type", "welcome")
    .maybeSingle();

  if (error || !data) return false;
  return data.status === "sent";
}

export type CandidateRow = { id: string; user_id: string; email_type: LaunchCohortEmailType };

/**
 * Finds rows that are at least superficially due (not yet terminal, and
 * eligible_at has passed) — a plain SELECT, not a claim. The actual claim
 * (and its atomicity) happens per-row in claimAndSend below.
 */
export async function findCandidateRows(
  supabaseAdmin: SupabaseClient,
  options: { userId?: string; limit?: number } = {}
): Promise<CandidateRow[]> {
  let query = supabaseAdmin
    .from("launch_cohort_emails")
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
 * The number of rows currently in status = 'suppressed', within scope. A
 * plain read taken fresh on every call, identical whether the caller is
 * doing a dry run or a real run — mirrors
 * lib/lifecycle-emails/service.ts:countSuppressedRows exactly.
 */
export async function countSuppressedRows(
  supabaseAdmin: SupabaseClient,
  options: { userId?: string } = {}
): Promise<number> {
  let query = supabaseAdmin
    .from("launch_cohort_emails")
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
  | { outcome: "skipped"; reason: "not_claimed" | "welcome_prerequisite_not_met" | "member_not_confirmed" };

/**
 * The full claim -> (eligibility re-check) -> build -> send -> complete
 * pipeline for exactly one row. Never sends without first successfully
 * claiming the row via the atomic RPC.
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
    "claim_launch_cohort_email",
    { p_id: candidate.id, p_lease_seconds: CLAIM_LEASE_SECONDS }
  );

  if (claimError || !claimed || claimed.length === 0) {
    // Not an error condition by itself — most commonly means another
    // worker already claimed it, or it isn't due yet after all.
    return { outcome: "skipped", reason: "not_claimed" };
  }

  const claim = claimed[0] as ClaimedLaunchCohortEmail;

  // story/routine/checkin must never send before welcome has actually been
  // sent — re-checked here, at claim time, using live state.
  if (claim.email_type !== "welcome") {
    const welcomeSent = await hasWelcomeBeenSent(supabaseAdmin, claim.user_id);
    if (!welcomeSent) {
      await supabaseAdmin.rpc("complete_launch_cohort_email", {
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
  const eligibleMember = userLookup?.user ? toEligibleMember(userLookup.user) : null;

  if (userLookupError || !eligibleMember) {
    return await failClaim(supabaseAdmin, claim, "member_lookup_failed_or_unconfirmed");
  }

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.appflowtrack.com"}/dashboard`;
  const displayName = eligibleMember.fullName ?? eligibleMember.email;
  const generatedAt = new Date().toISOString();

  const builtEmail =
    claim.email_type === "welcome"
      ? buildLaunchCohortWelcomeEmail({ userName: displayName, userEmail: eligibleMember.email, emailType: "launch_cohort_welcome", dashboardUrl, generatedAt })
      : claim.email_type === "story"
      ? buildLaunchCohortStoryEmail({ userName: displayName, userEmail: eligibleMember.email, emailType: "launch_cohort_story", dashboardUrl, generatedAt })
      : claim.email_type === "routine"
      ? buildLaunchCohortRoutineEmail({ userName: displayName, userEmail: eligibleMember.email, emailType: "launch_cohort_routine", dashboardUrl, generatedAt })
      : buildLaunchCohortCheckinEmail({ userName: displayName, userEmail: eligibleMember.email, emailType: "launch_cohort_checkin", generatedAt });

  // Stable per-ROW idempotency key — deliberately derived from claim.id
  // alone, never claim.claim_token. See
  // buildLaunchCohortEmailIdempotencyKey's own doc comment.
  const idempotencyKey = buildLaunchCohortEmailIdempotencyKey(claim.id);

  const result = await sendEmail(builtEmail, { idempotencyKey });

  if (!result.success) {
    return await failClaim(supabaseAdmin, claim, result.error ?? "send_failed");
  }

  await supabaseAdmin.rpc("complete_launch_cohort_email", {
    p_id: claim.id,
    p_claim_token: claim.claim_token,
    p_status: "sent",
    p_provider_message_id: result.id ?? null,
  });

  return { outcome: "sent", providerMessageId: result.id ?? null };
}

async function failClaim(
  supabaseAdmin: SupabaseClient,
  claim: ClaimedLaunchCohortEmail,
  errorMessage: string
): Promise<SendAttemptResult> {
  const { data: row } = await supabaseAdmin
    .from("launch_cohort_emails")
    .select("attempt_count")
    .eq("id", claim.id)
    .maybeSingle();

  const attemptCount = (row as { attempt_count: number } | null)?.attempt_count ?? 1;
  // Truncate defensively — last_error is operator-facing diagnostics, not
  // user content.
  const sanitizedError = errorMessage.slice(0, 300);
  const nextAttempt = computeNextAttempt(attemptCount, new Date());

  await supabaseAdmin.rpc("complete_launch_cohort_email", {
    p_id: claim.id,
    p_claim_token: claim.claim_token,
    p_status: nextAttempt ? "failed" : "exhausted",
    p_last_error: sanitizedError,
    p_next_attempt_at: nextAttempt ? nextAttempt.toISOString() : null,
  });

  return nextAttempt ? { outcome: "failed", willRetryAt: nextAttempt } : { outcome: "exhausted" };
}

/**
 * Narrow, deliberate STOP suppression: suppresses every not-yet-sent row
 * (all four email types — this campaign has no "essential first email"
 * exemption, unlike the signup lifecycle sequence's welcome) for exactly
 * the user_id passed in, and marks the roster row itself so a later re-run
 * of the enrollment-sync step can never recreate rows for this member. See
 * lib/security/launch_cohort_runbook.sql ("Manual STOP suppression") for
 * the current manual invocation path — there is no inbound-email
 * automation; a human still reads and processes every STOP reply.
 */
export async function suppressUpcomingLaunchCohortEmails(
  supabaseAdmin: SupabaseClient,
  userId: string,
  reason: string
): Promise<{ suppressed: number }> {
  const { data, error } = await supabaseAdmin
    .from("launch_cohort_emails")
    .update({ status: "suppressed", suppressed_at: new Date().toISOString(), suppression_reason: reason })
    .eq("user_id", userId)
    .in("email_type", LAUNCH_COHORT_EMAIL_TYPES)
    .not("status", "in", "(sent,suppressed)")
    .select("id");

  if (error) {
    throw new Error(`suppressUpcomingLaunchCohortEmails: update failed: ${error.message}`);
  }

  const { error: memberError } = await supabaseAdmin
    .from("launch_cohort_members")
    .update({ suppressed_at: new Date().toISOString(), suppression_reason: reason })
    .eq("user_id", userId);

  if (memberError) {
    throw new Error(`suppressUpcomingLaunchCohortEmails: member update failed: ${memberError.message}`);
  }

  return { suppressed: data?.length ?? 0 };
}

export { parseLaunchCohortStartAt, LAUNCH_COHORT_START_AT_ENV };
export type { CandidateRow as LaunchCohortCandidateRow };
