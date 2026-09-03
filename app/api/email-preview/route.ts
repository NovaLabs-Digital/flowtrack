import { NextResponse } from "next/server";
import {
  renderGoodMorning,
  renderBillReminder,
  renderCongratulations,
  renderWeeklyProgress,
  renderMonthlyProgress,
} from "@/lib/daily-companion";
import type { DailyReport, CongratulationsReport, WeeklyReport, MonthlyReport } from "@/lib/daily-companion";

export const runtime = "nodejs";

const mockDaily: DailyReport = {
  userName: "Alberto",
  userEmail: "demo@flowtrack.com",
  emailType: "good_morning",
  greeting: "Good morning, Alberto.",
  bills: [
    {
      name: "Apple Card",
      dueLabel: "Due Tomorrow",
      minimumPayment: 95.74,
      recommendedPayment: 145.74,
      freedomDaysGained: 11,
      balance: 4280,
      paymentSourceName: "Chase Checking",
      paymentSourceLast4: "1234",
    },
    {
      name: "Capital One Visa",
      dueLabel: "Coming Up",
      minimumPayment: 210,
      recommendedPayment: 210,
      freedomDaysGained: 0,
      balance: 3100,
      paymentSourceName: "Capital One Visa",
      paymentSourceLast4: "5678",
    },
    {
      name: "Auto Loan",
      dueLabel: "Coming Up",
      minimumPayment: 320,
      recommendedPayment: 320,
      freedomDaysGained: 0,
      balance: 12400,
      paymentSourceName: null,
      paymentSourceLast4: null,
    },
  ],
  freedomDate: "September 29, 2031",
  freedomDaysGained: 14,
  debtRemaining: 19840,
  progressPercent: 18,
  encouragement: "Every good financial decision builds a stronger tomorrow.",
  generatedAt: new Date().toISOString(),
};

const mockCongrats: CongratulationsReport = {
  userName: "Alberto",
  userEmail: "demo@flowtrack.com",
  emailType: "congratulations",
  achievement: "First Debt Paid Off",
  detail: "You've completely paid off your Discover card. That's real progress.",
  freedomDate: "August 14, 2031",
  encouragement: "Your future self will thank you for today's discipline.",
  generatedAt: new Date().toISOString(),
};

const mockWeekly: WeeklyReport = {
  userName: "Alberto",
  userEmail: "demo@flowtrack.com",
  emailType: "weekly_progress",
  periodLabel: "June 21 – June 28, 2026",
  totalIncome: 1125,
  totalExpenses: 680,
  debtReduced: 445,
  interestAvoided: 38,
  freedomDaysGained: 6,
  bestDecision: "Paying an extra $50 toward Apple Card",
  suggestion: "Consider moving $25 from Dining Out to debt payments next week.",
  freedomDate: "September 23, 2031",
  encouragement: "Consistency is the most powerful financial tool.",
  generatedAt: new Date().toISOString(),
};

const mockMonthly: MonthlyReport = {
  userName: "Alberto",
  userEmail: "demo@flowtrack.com",
  emailType: "monthly_progress",
  monthLabel: "June 2026",
  totalIncome: 4500,
  totalExpenses: 2850,
  netSavings: 1650,
  debtReduced: 1200,
  freedomDateMovement: 22,
  freedomDate: "September 7, 2031",
  progressPercent: 22,
  encouragement: "Progress, not perfection. You're doing great.",
  generatedAt: new Date().toISOString(),
};

// Single-bill scenarios matching the reminder cron's real behavior: when
// exactly one bill is eligible, buildGoodMorningEmail renders it through
// renderBillReminder (a single card) instead of the multi-bill digest.
function singleBillReport(bill: DailyReport["bills"][number]): DailyReport {
  return { ...mockDaily, bills: [bill] };
}

const mockBillBankAccount = singleBillReport({
  name: "Apple Card",
  dueLabel: "Due Tomorrow",
  minimumPayment: 95.74,
  recommendedPayment: 145.74,
  freedomDaysGained: 11,
  balance: 4280,
  paymentSourceName: "Chase Checking",
  paymentSourceLast4: "1234",
});

const mockBillCreditCard = singleBillReport({
  name: "Capital One Visa",
  dueLabel: "Coming Up",
  minimumPayment: 210,
  recommendedPayment: 210,
  freedomDaysGained: 0,
  balance: 3100,
  paymentSourceName: "Capital One Visa",
  paymentSourceLast4: "5678",
});

const mockBillLegacy = singleBillReport({
  name: "Auto Loan",
  dueLabel: "Coming Up",
  minimumPayment: 320,
  recommendedPayment: 320,
  freedomDaysGained: 0,
  balance: 12400,
  paymentSourceName: null,
  paymentSourceLast4: null,
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "good_morning";

  let rendered: { subject: string; html: string };

  switch (type) {
    case "congratulations":
      rendered = renderCongratulations(mockCongrats);
      break;
    case "weekly":
      rendered = renderWeeklyProgress(mockWeekly);
      break;
    case "monthly":
      rendered = renderMonthlyProgress(mockMonthly);
      break;
    case "bill_bank_account":
      rendered = renderBillReminder(mockBillBankAccount);
      break;
    case "bill_credit_card":
      rendered = renderBillReminder(mockBillCreditCard);
      break;
    case "bill_legacy":
      rendered = renderBillReminder(mockBillLegacy);
      break;
    default:
      rendered = renderGoodMorning(mockDaily);
      break;
  }

  if (searchParams.get("format") === "json") {
    return NextResponse.json({ subject: rendered.subject, html: rendered.html });
  }

  return new Response(rendered.html, {
    headers: { "Content-Type": "text/html" },
  });
}
