import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ensureLifecycleRows,
  findCandidateRows,
  claimAndSend,
  countSuppressedRows,
  toEligibleUser,
} from "@/lib/lifecycle-emails/service";
import { parseSignupEmailsStartAt, SIGNUP_EMAILS_START_AT_ENV } from "@/lib/lifecycle-emails/eligibility";
import { emptyRunSummary } from "@/lib/lifecycle-emails/types";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Identical convention to app/api/cron/bill-reminders/route.ts: Bearer
// CRON_SECRET, with the same X-Cron-Secret header fallback for manual
// testing clients that drop a custom Authorization header.
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

const PER_PAGE = 200;

async function discoverAndEnsureRows(
  cutoff: ReturnType<typeof parseSignupEmailsStartAt>,
  onlyUserId: string | undefined,
  discoveredCount: { value: number }
): Promise<void> {
  if (onlyUserId) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(onlyUserId);
    if (data?.user) {
      discoveredCount.value += 1;
      const eligibleUser = toEligibleUser(data.user);
      if (eligibleUser) {
        try {
          await ensureLifecycleRows(supabaseAdmin, eligibleUser, cutoff);
        } catch (err) {
          console.error("[signup-emails] ensureLifecycleRows failed for scoped user", {
            userId: onlyUserId,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }
    return;
  }

  // auth.admin.listUsers() is paginated — nextPage is null once exhausted
  // (node_modules/@supabase/auth-js GoTrueAdminApi.listUsers). Never
  // assume a single page covers every user.
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data) break;

    for (const user of data.users) {
      discoveredCount.value += 1;
      const eligibleUser = toEligibleUser(user);
      if (!eligibleUser) continue; // unconfirmed — never a candidate for any lifecycle email
      try {
        await ensureLifecycleRows(supabaseAdmin, eligibleUser, cutoff);
      } catch (err) {
        console.error("[signup-emails] ensureLifecycleRows failed for user", {
          // userId only — never an email address or name.
          userId: user.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    if (!("nextPage" in data) || data.nextPage === null) break;
    page = data.nextPage as number;
  }
}

async function runSignupEmails(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const onlyUserId = url.searchParams.get("userId") ?? undefined;

  const cutoff = parseSignupEmailsStartAt(process.env[SIGNUP_EMAILS_START_AT_ENV]);
  const summary = emptyRunSummary();

  if (cutoff === null) {
    // Fail closed, clearly, in both dry-run and real runs, BEFORE touching
    // Supabase at all — not even a read. A missing/invalid cutoff means
    // this route has no business asking the database anything yet:
    // summary.suppressed stays at its zero default (never a real count
    // fetched merely to populate a field on a run that sends nothing).
    return NextResponse.json({
      error: `Missing or invalid ${SIGNUP_EMAILS_START_AT_ENV}. Set it to an ISO-8601 timestamp before any lifecycle email can be sent.`,
      ...summary,
      ...(dryRun ? { dryRun: true } : {}),
    });
  }

  // A plain, scope-aware read of existing suppressions — identical whether
  // this is a dry run or a real run, since it never mutates anything. See
  // countSuppressedRows's own doc comment for the exact semantics: rows
  // suppressed in scope right now, not rows suppressed "during this run"
  // (the cron never suppresses a row itself). Only reached once the cutoff
  // is known valid, so this never runs on the fail-closed path above.
  try {
    summary.suppressed = await countSuppressedRows(supabaseAdmin, { userId: onlyUserId });
  } catch (err) {
    console.error("[signup-emails] countSuppressedRows failed", err instanceof Error ? err.message : "unknown error");
  }

  const discoveredCount = { value: 0 };
  try {
    await discoverAndEnsureRows(cutoff, onlyUserId, discoveredCount);
  } catch (err) {
    console.error("[signup-emails] discovery phase failed", err instanceof Error ? err.message : "unknown error");
  }
  summary.discovered = discoveredCount.value;

  let candidates;
  try {
    candidates = await findCandidateRows(supabaseAdmin, { userId: onlyUserId });
  } catch (err) {
    console.error("[signup-emails] findCandidateRows failed", err instanceof Error ? err.message : "unknown error");
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
        // No "suppressed" case: claimAndSend can never return that outcome
        // (see service.ts's SendAttemptResult comment) — summary.suppressed
        // is populated once, above, by countSuppressedRows.
        case "skipped":
        default:
          summary.skipped++;
          break;
      }
    } catch (err) {
      // Per-row isolation: one row's unexpected failure never aborts the
      // batch, matching app/api/cron/bill-reminders/route.ts.
      summary.failed++;
      console.error("[signup-emails] claimAndSend threw for row", {
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
  return runSignupEmails(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSignupEmails(req);
}
