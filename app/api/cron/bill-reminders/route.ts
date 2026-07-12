import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { scanBills } from "@/lib/bill-guardian";
import type { BillReminder, BillGuardianReport } from "@/lib/bill-guardian";
import { calculateFreedomReport } from "@/lib/financial-freedom";
import { buildDailyReport, buildGoodMorningEmail, sendEmail } from "@/lib/daily-companion";
import type { Debt } from "@/lib/debt-recovery";

export const runtime = "nodejs";

type SkipReason =
  | "paid_this_cycle"
  | "not_due_window"
  | "method_sms"
  | "overdue_not_sent_this_sprint"
  | "no_offset_configured"
  | "duplicate_suppressed";

type FailReason = "user_lookup_failed" | "send_failed";

type DebtDecision = {
  debtId: string;
  debtName: string;
  userId: string;
  decision: "sent" | "would_send" | "skipped" | "failed";
  reason?: SkipReason | FailReason;
};

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // Fallback for manual testing: some HTTP clients (notably Windows PowerShell's
  // Invoke-RestMethod/Invoke-WebRequest, and any request that gets redirected)
  // can fail to deliver a custom "Authorization" header. "X-Cron-Secret" is not
  // a reserved/redirect-stripped header name, so it's a reliable manual-test path.
  // Production Vercel Cron invocations continue to use Authorization: Bearer.
  const cronSecretHeader = req.headers.get("x-cron-secret");

  const bearerMatched =
    Boolean(cronSecret) && Boolean(auth) && auth!.trim() === `Bearer ${cronSecret!.trim()}`;
  const fallbackMatched =
    Boolean(cronSecret) && Boolean(cronSecretHeader) && cronSecretHeader!.trim() === cronSecret!.trim();
  const matched = bearerMatched || fallbackMatched;

  // TEMPORARY diagnostic logging — no secret values are logged, only booleans/lengths/header names.
  console.log("[bill-reminders] auth check", {
    hasEnvSecret: Boolean(cronSecret),
    envSecretLength: cronSecret?.length ?? 0,
    hasAuthHeader: Boolean(auth),
    authHeaderLength: auth?.length ?? 0,
    startsWithBearer: auth?.startsWith("Bearer ") ?? false,
    hasCronSecretHeader: Boolean(cronSecretHeader),
    cronSecretHeaderLength: cronSecretHeader?.length ?? 0,
    incomingHeaderNames: Array.from(req.headers.keys()),
    matched,
  });

  return matched;
}

function alreadySentThisWindow(lastSentIso: string | null): boolean {
  if (!lastSentIso) return false;
  const now = new Date();
  const sent = new Date(lastSentIso);
  return sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear();
}

function emptyReport(): BillGuardianReport {
  return {
    dueToday: [],
    dueTomorrow: [],
    upcoming: [],
    overdue: [],
    paidThisCycle: [],
    totalDueThisMonth: 0,
    totalOverdue: 0,
    nextDueDate: null,
    generatedAt: new Date().toISOString(),
  };
}

function reportWithOnly(bills: BillReminder[]): BillGuardianReport {
  const report = emptyReport();
  for (const bill of bills) {
    if (bill.status === "due_today") report.dueToday.push(bill);
    else if (bill.status === "due_tomorrow") report.dueTomorrow.push(bill);
    else if (bill.status === "upcoming") report.upcoming.push(bill);
  }
  return report;
}

async function runReminders(req: NextRequest) {
  const url = new URL(req.url);
  const testUserId = url.searchParams.get("userId");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const includeDetails = Boolean(testUserId) || dryRun;

  let candidateQuery = supabaseAdmin
    .from("debts")
    .select("*")
    .eq("status", "open")
    .eq("reminder_enabled", true);

  if (testUserId) {
    candidateQuery = candidateQuery.eq("user_id", testUserId);
  }

  const { data: candidateRows, error: candidateError } = await candidateQuery;

  if (candidateError) {
    return NextResponse.json(
      { processed: 0, sent: 0, skipped: 0, failed: 0, error: "Failed to load candidate debts" },
      { status: 500 }
    );
  }

  const candidates = (candidateRows ?? []) as Debt[];
  const byUser = new Map<string, Debt[]>();
  for (const debt of candidates) {
    if (!byUser.has(debt.user_id)) byUser.set(debt.user_id, []);
    byUser.get(debt.user_id)!.push(debt);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const details: DebtDecision[] = [];

  for (const [userId, userCandidates] of byUser) {
    try {
      const { data: allDebtRows, error: allDebtsError } = await supabaseAdmin
        .from("debts")
        .select("*")
        .eq("user_id", userId);

      if (allDebtsError || !allDebtRows) {
        for (const debt of userCandidates) {
          failed++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "failed", reason: "user_lookup_failed" });
        }
        console.error("[bill-reminders] Failed to load debts for user", userId, allDebtsError?.message);
        continue;
      }

      const allDebts = allDebtRows as Debt[];
      const openDebts = allDebts.filter((d) => d.status === "open");
      const freedom = openDebts.length > 0 ? calculateFreedomReport(allDebts, 0, 0) : null;
      const report = scanBills(allDebts, freedom);

      const reminderByDebtId = new Map<string, BillReminder>();
      for (const r of [...report.dueToday, ...report.dueTomorrow, ...report.upcoming, ...report.overdue]) {
        reminderByDebtId.set(r.debtId, r);
      }

      const eligible: BillReminder[] = [];

      for (const debt of userCandidates) {
        const reminder = reminderByDebtId.get(debt.id);

        if (!reminder) {
          // Not in any active bucket: either paid this cycle, or more than 7 days out.
          skipped++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "skipped", reason: "paid_this_cycle" });
          continue;
        }

        if (reminder.reminderMethod === "sms") {
          skipped++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "skipped", reason: "method_sms" });
          continue;
        }

        if (reminder.status === "overdue") {
          skipped++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "skipped", reason: "overdue_not_sent_this_sprint" });
          continue;
        }

        if (reminder.reminderOffset == null || reminder.dueInDays !== reminder.reminderOffset) {
          skipped++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "skipped", reason: reminder.reminderOffset == null ? "no_offset_configured" : "not_due_window" });
          continue;
        }

        if (alreadySentThisWindow(debt.last_reminder_sent_at)) {
          skipped++;
          details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "skipped", reason: "duplicate_suppressed" });
          continue;
        }

        eligible.push(reminder);
      }

      if (eligible.length === 0) continue;

      const { data: userLookup, error: userLookupError } = await supabaseAdmin.auth.admin.getUserById(userId);
      const authUser = userLookup?.user;

      if (userLookupError || !authUser?.email) {
        for (const reminder of eligible) {
          failed++;
          details.push({ debtId: reminder.debtId, debtName: reminder.debtName, userId, decision: "failed", reason: "user_lookup_failed" });
        }
        console.error("[bill-reminders] Failed to resolve email for user", userId, userLookupError?.message);
        continue;
      }

      const fullName = typeof authUser.user_metadata?.full_name === "string" ? authUser.user_metadata.full_name : "";
      const userName = fullName || authUser.email;

      const dailyReport = buildDailyReport(userName, authUser.email, reportWithOnly(eligible), freedom);
      if (!dailyReport) continue;

      const email = buildGoodMorningEmail(dailyReport);

      if (dryRun) {
        for (const reminder of eligible) {
          sent++;
          details.push({ debtId: reminder.debtId, debtName: reminder.debtName, userId, decision: "would_send" });
        }
        continue;
      }

      const result = await sendEmail(email);

      if (!result.success) {
        for (const reminder of eligible) {
          failed++;
          details.push({ debtId: reminder.debtId, debtName: reminder.debtName, userId, decision: "failed", reason: "send_failed" });
        }
        console.error("[bill-reminders] Send failed for user", userId, "debts:", eligible.length, "error:", result.error);
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from("debts")
        .update({ last_reminder_sent_at: new Date().toISOString() })
        .in("id", eligible.map((r) => r.debtId))
        .eq("user_id", userId);

      if (updateError) {
        console.error("[bill-reminders] Sent email but failed to record last_reminder_sent_at for user", userId, updateError.message);
      }

      for (const reminder of eligible) {
        sent++;
        details.push({ debtId: reminder.debtId, debtName: reminder.debtName, userId, decision: "sent" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      for (const debt of userCandidates) {
        failed++;
        details.push({ debtId: debt.id, debtName: debt.name, userId, decision: "failed", reason: "send_failed" });
      }
      console.error("[bill-reminders] Unexpected error processing user", userId, message);
    }
  }

  const summary = {
    processed: candidates.length,
    sent,
    skipped,
    failed,
    ...(dryRun ? { dryRun: true } : {}),
    ...(includeDetails ? { details } : {}),
  };

  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runReminders(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runReminders(req);
}
