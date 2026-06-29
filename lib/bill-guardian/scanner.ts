import type { Debt } from "../debt-recovery/types";
import type { FinancialFreedomReport } from "../financial-freedom/types";
import type { BillReminder, BillGuardianReport, ReminderStatus } from "./types";

function formatDueDate(dueDay: number): string {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  return thisMonth.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

function isPaidThisCycle(debt: Debt): boolean {
  if (!debt.last_payment_date) return false;
  const now = new Date();
  const paid = new Date(debt.last_payment_date + "T00:00:00");
  return paid.getMonth() === now.getMonth() && paid.getFullYear() === now.getFullYear();
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
  freedom: FinancialFreedomReport | null
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
    dueDateFormatted: formatDueDate(debt.due_day),
    minimumPayment: debt.minimum_payment,
    recommendedPayment: recommended,
    balance: debt.balance,
    apr: debt.apr,
    freedomDaysGained: estimateFreedomDaysGained(debt, freedom),
    lastPaymentDate: debt.last_payment_date,
    reminderEnabled: debt.reminder_enabled,
    reminderMethod: debt.reminder_method,
    reminderOffset: debt.reminder_offset,
  };
}

export function scanBills(
  debts: Debt[],
  freedom: FinancialFreedomReport | null
): BillGuardianReport {
  const now = new Date();
  const today = now.getDate();
  const openDebts = debts.filter((d) => d.status === "open");

  const dueToday: BillReminder[] = [];
  const dueTomorrow: BillReminder[] = [];
  const upcoming: BillReminder[] = [];
  const overdue: BillReminder[] = [];
  const paidThisCycle: BillReminder[] = [];

  for (const debt of openDebts) {
    if (isPaidThisCycle(debt)) {
      paidThisCycle.push(buildReminder(debt, "paid", freedom));
      continue;
    }

    const due = debt.due_day;
    const diff = due - today;

    if (diff < 0) {
      overdue.push(buildReminder(debt, "overdue", freedom));
    } else if (diff === 0) {
      dueToday.push(buildReminder(debt, "due_today", freedom));
    } else if (diff === 1) {
      dueTomorrow.push(buildReminder(debt, "due_tomorrow", freedom));
    } else if (diff <= 7) {
      upcoming.push(buildReminder(debt, "upcoming", freedom));
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
    totalDueThisMonth: openDebts.filter((d) => !isPaidThisCycle(d)).length,
    totalOverdue: overdue.length,
    nextDueDate,
    generatedAt: new Date().toISOString(),
  };
}
