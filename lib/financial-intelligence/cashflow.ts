import type { Transaction, CashFlowAnalysis } from "./types";
import {
  groupByMonth,
  sumAmounts,
  computeTrend,
  currentMonthKey,
  daysElapsedInMonth,
  daysInCurrentMonth,
} from "./utils";

export function analyzeCashFlow(
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string
): CashFlowAnalysis {
  const _ = { periodStart, periodEnd };

  const totalIncome = sumAmounts(transactions.filter((t) => t.type === "income"));
  const totalExpenses = sumAmounts(transactions.filter((t) => t.type === "expense"));
  const currentNet = totalIncome - totalExpenses;

  const byMonth = groupByMonth(transactions);
  const months = Array.from(byMonth.keys()).sort();

  const monthlyBreakdown = months.map((month) => {
    const txns = byMonth.get(month) ?? [];
    const inc = sumAmounts(txns.filter((t) => t.type === "income"));
    const exp = sumAmounts(txns.filter((t) => t.type === "expense"));
    return { month, total: inc - exp };
  });

  const values = monthlyBreakdown.map((m) => m.total);
  const avgMonthlyNet = values.length > 0
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 0;

  const trend = computeTrend(values);

  const currentMonth = currentMonthKey();
  const thisMonthTxns = transactions.filter((t) => t.date.startsWith(currentMonth));
  const thisIncome = sumAmounts(thisMonthTxns.filter((t) => t.type === "income"));
  const thisExpenses = sumAmounts(thisMonthTxns.filter((t) => t.type === "expense"));
  const elapsed = daysElapsedInMonth();
  const totalDays = daysInCurrentMonth();
  const multiplier = totalDays / Math.max(elapsed, 1);

  const projectedMonthlyNet = Math.round(
    thisIncome * multiplier - thisExpenses * multiplier
  );

  const avgDailyExpense = elapsed > 0 ? thisExpenses / elapsed : 0;
  const remainingDays = totalDays - elapsed;
  const projectedRemainingExpenses = avgDailyExpense * remainingDays;
  const discretionarySpending = Math.max(
    0,
    Math.round(thisIncome - thisExpenses - projectedRemainingExpenses)
  );

  void _;

  return {
    currentNet,
    avgMonthlyNet,
    projectedMonthlyNet,
    discretionarySpending,
    trend: trend.direction,
    trendPercent: trend.percent,
    monthlyBreakdown,
  };
}
