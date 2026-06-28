import type { Transaction, SavingsAnalysis, MonthlyBreakdown } from "./types";
import { groupByMonth, sumAmounts, computeTrend } from "./utils";

export function analyzeSavings(
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string
): SavingsAnalysis {
  const _ = { periodStart, periodEnd };

  const totalIncome = sumAmounts(transactions.filter((t) => t.type === "income"));
  const totalExpenses = sumAmounts(transactions.filter((t) => t.type === "expense"));
  const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

  const byMonth = groupByMonth(transactions);
  const months = Array.from(byMonth.keys()).sort();

  const monthlyBreakdown: MonthlyBreakdown[] = months.map((month) => {
    const txns = byMonth.get(month) ?? [];
    const inc = sumAmounts(txns.filter((t) => t.type === "income"));
    const exp = sumAmounts(txns.filter((t) => t.type === "expense"));
    return { month, total: inc - exp };
  });

  const values = monthlyBreakdown.map((m) => m.total);
  const trend = computeTrend(values);

  const sorted = [...monthlyBreakdown].sort((a, b) => a.total - b.total);
  const worstMonth = sorted.length > 0 ? sorted[0] : null;
  const bestMonth = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const avgMonthlySavings = values.length > 0
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 0;

  void _;

  return {
    savingsRate,
    avgMonthlySavings,
    bestMonth,
    worstMonth,
    trend: trend.direction,
    trendPercent: trend.percent,
    monthlyBreakdown,
  };
}
