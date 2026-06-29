import type { BillGuardianReport } from "../bill-guardian/types";
import type { FinancialFreedomReport } from "../financial-freedom/types";
import type { DailyReport, BillDue } from "./types";

const ENCOURAGEMENTS = [
  "Every good financial decision builds a stronger tomorrow.",
  "Small steps today create big results over time.",
  "You're closer to Financial Freedom than yesterday.",
  "Consistency is the most powerful financial tool.",
  "Your future self will thank you for today's discipline.",
  "Progress, not perfection. You're doing great.",
  "Financial freedom is built one decision at a time.",
  "Stay the course. You're making real progress.",
];

function pickEncouragement(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return ENCOURAGEMENTS[dayOfYear % ENCOURAGEMENTS.length];
}

function formatFreedomDate(iso: string): string {
  if (!iso) return "Not yet calculated";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function buildDailyReport(
  userName: string,
  userEmail: string,
  bills: BillGuardianReport,
  freedom: FinancialFreedomReport | null
): DailyReport | null {
  const actionableBills: BillDue[] = [];

  for (const bill of [...bills.dueToday, ...bills.dueTomorrow, ...bills.overdue]) {
    actionableBills.push({
      name: bill.debtName,
      dueLabel:
        bill.status === "due_today"
          ? "Due Today"
          : bill.status === "due_tomorrow"
          ? "Due Tomorrow"
          : "Needs Attention",
      minimumPayment: bill.minimumPayment,
      recommendedPayment: bill.recommendedPayment,
      freedomDaysGained: bill.freedomDaysGained,
      balance: bill.balance,
    });
  }

  if (actionableBills.length === 0 && !freedom) return null;

  const firstName = userName.split(" ")[0] || userName || "there";

  return {
    userName: firstName,
    userEmail,
    emailType: "good_morning",
    greeting: `Good morning, ${firstName}.`,
    bills: actionableBills,
    freedomDate: freedom ? formatFreedomDate(freedom.financialFreedomDate) : "Not yet calculated",
    freedomDaysGained: freedom?.monthsSaved ? freedom.monthsSaved * 30 : 0,
    debtRemaining: freedom?.debtRemaining ?? 0,
    progressPercent: freedom?.progressPercent ?? 0,
    encouragement: pickEncouragement(),
    generatedAt: new Date().toISOString(),
  };
}
