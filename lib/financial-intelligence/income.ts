import type { Transaction, IncomeAnalysis } from "./types";
import { sumAmounts, monthlyTotals, countWeeks, countMonths, computeTrend, stddev } from "./utils";

export function analyzeIncome(
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string
): IncomeAnalysis {
  const incomeTxns = transactions.filter((t) => t.type === "income");
  const total = sumAmounts(incomeTxns);
  const weeks = countWeeks(periodStart, periodEnd);
  const months = countMonths(periodStart, periodEnd);
  const breakdown = monthlyTotals(incomeTxns);
  const monthlyValues = breakdown.map((m) => m.total);

  const trend = computeTrend(monthlyValues);

  const sorted = [...breakdown].sort((a, b) => a.total - b.total);
  const lowestMonth = sorted.length > 0 ? sorted[0] : null;
  const highestMonth = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const mean = monthlyValues.length > 0
    ? monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.length
    : 0;
  const sd = stddev(monthlyValues);
  const consistency = mean > 0 ? Math.round(Math.max(0, 100 - (sd / mean) * 100)) : 0;

  return {
    total,
    avgMonthly: Math.round(total / months),
    avgWeekly: Math.round(total / weeks),
    highestMonth,
    lowestMonth,
    trend: trend.direction,
    trendPercent: trend.percent,
    consistency,
    monthlyBreakdown: breakdown,
  };
}
