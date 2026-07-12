import type { Debt } from "../debt-recovery/types";
import type { FinancialFreedomReport } from "../financial-freedom/types";
import type { BillReminder, BillGuardianReport, ReminderStatus } from "./types";
import { resolveDueOccurrence, type DateParts } from "./date";

function formatDueDate(parts: DateParts): string {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isPaidThisCycle(debt: Debt, today: DateParts): boolean {
  if (!debt.last_payment_date) return false;
  const [year, month] = debt.last_payment_date.split("-").map(Number);
  return month === today.month && year === today.year;
}

function estimateFreedomDaysGained(
  debt: Debt,
  freedom: FinancialFreedomReport | null
): number {
  if (!freedom || freedom.monthsRemaining <= 0) return 0;
  const extra =
    debt.payment_plan === "custom" && debt.custom_payment
      ? Math.max(debt.custom_payment - debt.minimum_payment, 0)
      : 0;
  if (extra <= 0) return 0;
  const totalDebt = freedom.debtRemaining;
  if (totalDebt <= 0) return 0;
  const impactRatio = extra / totalDebt;
  return Math.max(1, Math.round(impactRatio * freedom.daysRemaining));
}

function buildReminder(
  debt: Debt,
  status: ReminderStatus,
  freedom: FinancialFreedomReport | null,
  occurrence: DateParts,
  dueInDays: number
): BillReminder {
  const recommended =
    debt.payment_plan === "custom" && debt.custom_payment && debt.custom_payment > debt.minimum_payment
      ? debt.custom_payment
      : debt.minimum_payment;

  return {
    debtId: debt.id,
    debtName: debt.name,
    debtType: debt.type,
    status,
    dueDay: debt.due_day,
    dueDateFormatted: formatDueDate(occurrence),
    minimumPayment: debt.minimum_payment,
    recommendedPayment: recommended,
    balance: debt.balance,
    apr: debt.apr,
    freedomDaysGained: estimateFreedomDaysGained(debt, freedom),
    lastPaymentDate: debt.last_payment_date,
    reminderEnabled: debt.reminder_enabled,
    reminderMethod: debt.reminder_method,
    reminderOffset: debt.reminder_offset,
    dueInDays,
  };
}

export function scanBills(
  debts: Debt[],
  freedom: FinancialFreedomReport | null,
  today: DateParts
): BillGuardianReport {
  const openDebts = debts.filter((d) => d.status === "open");

  const dueToday: BillReminder[] = [];
  const dueTomorrow: BillReminder[] = [];
  const upcoming: BillReminder[] = [];
  const overdue: BillReminder[] = [];
  const paidThisCycle: BillReminder[] = [];

  for (const debt of openDebts) {
    const occurrence = resolveDueOccurrence(debt.due_day, today);
    const diff = occurrence.dueInDays;

    if (isPaidThisCycle(debt, today)) {
      paidThisCycle.push(buildReminder(debt, "paid", freedom, occurrence, diff));
      continue;
    }

    if (diff < 0) {
      overdue.push(buildReminder(debt, "overdue", freedom, occurrence, diff));
    } else if (diff === 0) {
      dueToday.push(buildReminder(debt, "due_today", freedom, occurrence, diff));
    } else if (diff === 1) {
      dueTomorrow.push(buildReminder(debt, "due_tomorrow", freedom, occurrence, diff));
    } else if (diff <= 7) {
      upcoming.push(buildReminder(debt, "upcoming", freedom, occurrence, diff));
    }
  }

  overdue.sort((a, b) => a.dueDay - b.dueDay);
  upcoming.sort((a, b) => a.dueDay - b.dueDay);

  const allUnpaid = [...dueToday, ...dueTomorrow, ...upcoming];
  const nextDueDate = allUnpaid.length > 0
    ? allUnpaid.sort((a, b) => a.dueDay - b.dueDay)[0].dueDateFormatted
    : null;

  return {
    dueToday,
    dueTomorrow,
    upcoming,
    overdue,
    paidThisCycle,
    totalDueThisMonth: openDebts.filter((d) => !isPaidThisCycle(d, today)).length,
    totalOverdue: overdue.length,
    nextDueDate,
    generatedAt: new Date().toISOString(),
  };
}
