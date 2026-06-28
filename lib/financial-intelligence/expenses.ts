import type { Transaction, ExpenseAnalysis, CategoryBreakdown } from "./types";
import {
  sumAmounts,
  monthlyTotals,
  countWeeks,
  countMonths,
  computeTrend,
  groupByMonth,
  stddev,
} from "./utils";

function buildCategoryBreakdown(txns: Transaction[], total: number): CategoryBreakdown[] {
  const map = new Map<string, { sum: number; count: number }>();
  for (const t of txns) {
    const entry = map.get(t.category);
    if (entry) {
      entry.sum += t.amount;
      entry.count += 1;
    } else {
      map.set(t.category, { sum: t.amount, count: 1 });
    }
  }

  const result: CategoryBreakdown[] = [];
  for (const [category, { sum, count }] of map) {
    result.push({
      category,
      total: sum,
      count,
      avgPerTransaction: Math.round(sum / count),
      percentOfTotal: total > 0 ? Math.round((sum / total) * 100) : 0,
    });
  }
  return result.sort((a, b) => b.total - a.total);
}

function detectRecurring(
  txns: Transaction[],
  months: number
): { category: string; avgAmount: number; frequency: number }[] {
  const byCat = new Map<string, number[]>();
  for (const t of txns) {
    const arr = byCat.get(t.category);
    if (arr) arr.push(t.amount);
    else byCat.set(t.category, [t.amount]);
  }

  const results: { category: string; avgAmount: number; frequency: number }[] = [];
  for (const [category, amounts] of byCat) {
    const avgAmount = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    const sd = stddev(amounts);
    const cv = avgAmount > 0 ? sd / avgAmount : 1;
    if (cv < 0.3 && amounts.length >= Math.max(months * 0.5, 2)) {
      results.push({
        category,
        avgAmount,
        frequency: amounts.length,
      });
    }
  }
  return results.sort((a, b) => b.frequency - a.frequency);
}

function detectUnusual(txns: Transaction[]): Transaction[] {
  if (txns.length < 5) return [];

  const amounts = txns.map((t) => t.amount);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const sd = stddev(amounts);
  const threshold = mean + 2 * sd;

  return txns
    .filter((t) => t.amount > threshold)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

function computeCategoryGrowth(txns: Transaction[]) {
  const byMonth = groupByMonth(txns);
  const sortedMonths = Array.from(byMonth.keys()).sort();
  if (sortedMonths.length < 2) return [];

  const mid = Math.floor(sortedMonths.length / 2);
  const firstMonths = sortedMonths.slice(0, mid);
  const secondMonths = sortedMonths.slice(mid);

  function catTotals(months: string[]) {
    const map = new Map<string, number>();
    for (const m of months) {
      for (const t of byMonth.get(m) ?? []) {
        map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
      }
    }
    return map;
  }

  const first = catTotals(firstMonths);
  const second = catTotals(secondMonths);
  const allCats = new Set([...first.keys(), ...second.keys()]);

  const results: { category: string; changePercent: number; direction: "up" | "down" | "flat" }[] = [];
  for (const cat of allCats) {
    const a = (first.get(cat) ?? 0) / Math.max(firstMonths.length, 1);
    const b = (second.get(cat) ?? 0) / Math.max(secondMonths.length, 1);
    if (a === 0 && b === 0) continue;
    const change = a === 0 ? 100 : Math.round(((b - a) / a) * 100);
    const direction = Math.abs(change) < 5 ? "flat" as const : change > 0 ? "up" as const : "down" as const;
    results.push({ category: cat, changePercent: Math.abs(change), direction });
  }
  return results.sort((a, b) => b.changePercent - a.changePercent);
}

export function analyzeExpenses(
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string
): ExpenseAnalysis {
  const expTxns = transactions.filter((t) => t.type === "expense");
  const total = sumAmounts(expTxns);
  const weeks = countWeeks(periodStart, periodEnd);
  const months = countMonths(periodStart, periodEnd);
  const breakdown = monthlyTotals(expTxns);
  const monthlyValues = breakdown.map((m) => m.total);

  const trend = computeTrend(monthlyValues);
  const ranking = buildCategoryBreakdown(expTxns, total);

  return {
    total,
    avgMonthly: Math.round(total / months),
    avgWeekly: Math.round(total / weeks),
    topCategories: ranking.slice(0, 5),
    categoryRanking: ranking,
    categoryGrowth: computeCategoryGrowth(expTxns),
    recurringExpenses: detectRecurring(expTxns, months),
    unusualExpenses: detectUnusual(expTxns),
    monthlyBreakdown: breakdown,
    trend: trend.direction,
    trendPercent: trend.percent,
  };
}
