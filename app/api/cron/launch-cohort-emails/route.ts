import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ensureLaunchCohortRows,
  findActiveMembers,
  findCandidateRows,
  claimAndSend,
  countSuppressedRows,
  toEligibleMember,
} from "@/lib/launch-cohort/service";
import { parseLaunchCohortStartAt, LAUNCH_COHORT_START_AT_ENV } from "@/lib/launch-cohort/eligibility";
import { emptyLaunchCohortRunSummary } from "@/lib/launch-cohort/types";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Identical convention to app/api/cron/bill-reminders/route.ts and
// app/api/cron/signup-emails/route.ts: Bearer CRON_SECRET, with the same
// X-Cron-Secret header fallback for manual testing clients that drop a
// custom Authorization header. Duplicated here rather than shared, matching
// this repo's existing convention of one self-contained isAuthorized per
// cron route.
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");

  const bearerMatched =
    Boolean(cronSecret) && Boolean(auth) && auth!.trim() === `Bearer ${cronSecret!.trim()}`;
  const fallbackMatched =
    Boolean(cronSecret) && Boolean(cronSecretHeader) && cronSecretHeader!.trim() === cronSecret!.trim();

  return bearerMatched || fallbackMatched;
}

/**
 * Discovers the not-suppressed enrolled roster (public.launch_cohort_members
 * — populated only by Alberto's manual runbook step, never by this route)
 * and ensures each member's four campaign rows exist. Scoped to exactly one
 * user_id when onlyUserId is given (single-user test mode). Deliberately
 * does NOT paginate all of auth.users like the signup-emails cron does —
 * the roster is small and explicit, so this only ever touches the members
 * Alberto actually approved.
 */
async function discoverAndEnsureRows(
  campaignStart: ReturnType<typeof parseLaunchCohortStartAt>,
  onlyUserId: string | undefined,
  discoveredCount: { value: number }
): Promise<void> {
  const activeMembers = await findActiveMembers(supabaseAdmin, { userId: onlyUserId });

  for (const member of activeMembers) {
    discoveredCount.value += 1;
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(member.userId);
    if (error || !data?.user) {
      console.error("[launch-cohort-emails] getUserById failed for roster member", {
        userId: member.userId,
        error: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    const eligibleMember = toEligibleMember(data.user);
    if (!eligibleMember) continue; // unconfirmed — never a candidate for any launch-cohort email

    try {
      await ensureLaunchCohortRows(supabaseAdmin, eligibleMember, campaignStart);
    } catch (err) {
      console.error("[launch-cohort-emails] ensureLaunchCohortRows failed for member", {
        // userId only — never an email address or name.
        userId: member.userId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

async function runLaunchCohortEmails(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const onlyUserId = url.searchParams.get("userId") ?? undefined;

  const campaignStart = parseLaunchCohortStartAt(process.env[LAUNCH_COHORT_START_AT_ENV]);
  const summary = emptyLaunchCohortRunSummary();

  if (campaignStart === null) {
    // Fail closed, clearly, in both dry-run and real runs, BEFORE touching
    // Supabase at all — not even a read. A missing/invalid campaign start
    // means this route has no business asking the database anything yet.
    // This is what makes a deploy send zero launch-cohort emails by
    // default: nothing sends until LAUNCH_COHORT_START_AT is explicitly
    // configured in Production.
    return NextResponse.json({
      error: `Missing or invalid ${LAUNCH_COHORT_START_AT_ENV}. Set it to an ISO-8601 timestamp before any launch-cohort email can be sent.`,
      ...summary,
      ...(dryRun ? { dryRun: true } : {}),
    });
  }

  // A plain, scope-aware read of existing suppressions — identical whether
  // this is a dry run or a real run, since it never mutates anything. Only
  // reached once campaignStart is known valid.
  try {
    summary.suppressed = await countSuppressedRows(supabaseAdmin, { userId: onlyUserId });
  } catch (err) {
    console.error("[launch-cohort-emails] countSuppressedRows failed", err instanceof Error ? err.message : "unknown error");
  }

  const discoveredCount = { value: 0 };
  try {
    await discoverAndEnsureRows(campaignStart, onlyUserId, discoveredCount);
  } catch (err) {
    console.error("[launch-cohort-emails] discovery phase failed", err instanceof Error ? err.message : "unknown error");
  }
  summary.discovered = discoveredCount.value;

  let candidates;
  try {
    candidates = await findCandidateRows(supabaseAdmin, { userId: onlyUserId });
  } catch (err) {
    console.error("[launch-cohort-emails] findCandidateRows failed", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json({ ...summary, error: "Failed to load candidate rows" }, { status: 500 });
  }

  summary.eligible = candidates.length;

  for (const candidate of candidates) {
    try {
      const result = await claimAndSend(supabaseAdmin, candidate, { dryRun });

      switch (result.outcome) {
        case "sent":
          summary.claimed++;
          summary.sent++;
          break;
        case "failed":
          summary.claimed++;
          summary.failed++;
          break;
        case "exhausted":
          summary.claimed++;
          summary.exhausted++;
          break;
        case "skipped":
        default:
          summary.skipped++;
          break;
      }
    } catch (err) {
      // Per-row isolation: one row's unexpected failure never aborts the
      // batch, matching app/api/cron/signup-emails/route.ts.
      summary.failed++;
      console.error("[launch-cohort-emails] claimAndSend threw for row", {
        rowId: candidate.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ...summary,
    ...(dryRun ? { dryRun: true } : {}),
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runLaunchCohortEmails(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runLaunchCohortEmails(req);
}
