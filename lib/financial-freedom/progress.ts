import type { FinancialFreedomReport, MovementReport, Milestone, MilestoneType } from "./types";
import type { Debt } from "../debt-recovery/types";

export function compareReports(
  previous: FinancialFreedomReport,
  current: FinancialFreedomReport
): MovementReport {
  const prevDate = new Date(previous.financialFreedomDate);
  const currDate = new Date(current.financialFreedomDate);
  const diffMs = prevDate.getTime() - currDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return {
    daysMovedForward: Math.max(diffDays, 0),
    daysMovedBackward: Math.max(-diffDays, 0),
    monthsSaved: Math.max(previous.monthsRemaining - current.monthsRemaining, 0),
    interestSaved: Math.round(
      Math.max(previous.projectedInterest - current.projectedInterest, 0) * 100
    ) / 100,
    progressChange: current.progressPercent - previous.progressPercent,
    previousDate: previous.financialFreedomDate,
    currentDate: current.financialFreedomDate,
  };
}

export function computeMilestones(debts: Debt[]): Milestone[] {
  const all = debts;
  const paidOff = all.filter((d) => d.status === "paid_off");
  const open = all.filter((d) => d.status === "open");

  const totalOriginal = all.reduce((s, d) => s + d.balance, 0);
  const totalRemaining = open.reduce((s, d) => s + d.balance, 0);
  const eliminated = totalOriginal > 0
    ? ((totalOriginal - totalRemaining) / totalOriginal) * 100
    : 0;

  const defs: { type: MilestoneType; title: string; threshold: number }[] = [
    { type: "first_debt_paid", title: "First debt paid off", threshold: -1 },
    { type: "quarter_eliminated", title: "25% of debt eliminated", threshold: 25 },
    { type: "half_eliminated", title: "50% of debt eliminated", threshold: 50 },
    { type: "three_quarter_eliminated", title: "75% of debt eliminated", threshold: 75 },
    { type: "debt_free", title: "Financial freedom achieved", threshold: 100 },
  ];

  return defs.map((def) => {
    let achieved: boolean;
    let progressPercent: number;

    if (def.type === "first_debt_paid") {
      achieved = paidOff.length > 0;
      progressPercent = achieved ? 100 : 0;
    } else {
      achieved = eliminated >= def.threshold;
      progressPercent = Math.min(Math.round((eliminated / def.threshold) * 100), 100);
    }

    return {
      type: def.type,
      title: def.title,
      achieved,
      progressPercent,
    };
  });
}

export function computeTimeSavedMilestones(
  monthsSaved: number
): Milestone[] {
  const defs: { type: MilestoneType; title: string; months: number }[] = [
    { type: "one_year_saved", title: "One year saved on payoff", months: 12 },
    { type: "two_years_saved", title: "Two years saved on payoff", months: 24 },
  ];

  return defs.map((def) => ({
    type: def.type,
    title: def.title,
    achieved: monthsSaved >= def.months,
    progressPercent: Math.min(Math.round((monthsSaved / def.months) * 100), 100),
  }));
}
