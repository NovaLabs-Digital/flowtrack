import type { Debt, StrategyComparison } from "../debt-recovery/types";
import type { FinancialFreedomReport } from "./types";
import { compareStrategies, computeDebtSummary } from "../debt-recovery";

export function calculateFreedomReport(
  debts: Debt[],
  monthlySurplus: number,
  extraPayment: number
): FinancialFreedomReport {
  const openDebts = debts.filter((d) => d.status === "open" && d.balance > 0);
  const summary = computeDebtSummary(debts);
  const allDebtTotal = debts.reduce((s, d) => s + d.balance, 0);
  const paidOff = debts.filter((d) => d.status === "paid_off");
  const paidTotal = paidOff.reduce((s, d) => s + d.balance, 0);

  if (openDebts.length === 0) {
    return {
      financialFreedomDate: new Date().toISOString().slice(0, 10),
      daysRemaining: 0,
      monthsRemaining: 0,
      yearsRemaining: 0,
      currentStrategy: "avalanche",
      totalDebt: allDebtTotal + paidTotal,
      debtRemaining: 0,
      projectedInterest: 0,
      monthlyDebtPayment: 0,
      recommendedExtraPayment: 0,
      interestSaved: 0,
      monthsSaved: 0,
      progressPercent: 100,
      monthlySurplus,
      generatedAt: new Date().toISOString(),
    };
  }

  const comparison: StrategyComparison = compareStrategies(openDebts, extraPayment);
  const best = comparison.recommendedStrategy === "snowball"
    ? comparison.snowball
    : comparison.avalanche;
  const worse = comparison.recommendedStrategy === "snowball"
    ? comparison.avalanche
    : comparison.snowball;

  const freedomDate = new Date();
  freedomDate.setMonth(freedomDate.getMonth() + best.totalMonths);
  const freedomDateStr = freedomDate.toISOString().slice(0, 10);

  const now = new Date();
  const diffMs = freedomDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const monthsRemaining = best.totalMonths;
  const yearsRemaining = Math.round((monthsRemaining / 12) * 10) / 10;

  const totalOriginalDebt = allDebtTotal + paidTotal;
  const progressPercent = totalOriginalDebt > 0
    ? Math.round(((totalOriginalDebt - summary.totalDebt) / totalOriginalDebt) * 100)
    : 0;

  const recommendedExtra = computeRecommendedExtra(monthlySurplus, summary.totalMinimumPayments);

  return {
    financialFreedomDate: freedomDateStr,
    daysRemaining,
    monthsRemaining,
    yearsRemaining,
    currentStrategy: comparison.recommendedStrategy,
    totalDebt: totalOriginalDebt,
    debtRemaining: summary.totalDebt,
    projectedInterest: best.totalInterest,
    monthlyDebtPayment: summary.totalMinimumPayments + extraPayment,
    recommendedExtraPayment: recommendedExtra,
    interestSaved: Math.round(Math.abs(worse.totalInterest - best.totalInterest) * 100) / 100,
    monthsSaved: comparison.monthsSaved,
    progressPercent,
    monthlySurplus,
    generatedAt: new Date().toISOString(),
  };
}

function computeRecommendedExtra(monthlySurplus: number, totalMinimums: number): number {
  if (monthlySurplus <= 0) return 0;
  const available = monthlySurplus - totalMinimums;
  if (available <= 0) return 0;
  const recommended = Math.round(available * 0.3);
  return Math.max(recommended, 25);
}
