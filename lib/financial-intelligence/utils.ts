import type { Transaction, MonthKey, MonthlyBreakdown, TrendDirection } from "./types";

export function getMonthKey(date: string): MonthKey {
  return date.slice(0, 7);
}

export function groupByMonth(transactions: Transaction[]): Map<MonthKey, Transaction[]> {
  const map = new Map<MonthKey, Transaction[]>();
  for (const t of transactions) {
    const key = getMonthKey(t.date);
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  }
  return map;
}

export function sumAmounts(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

export function monthlyTotals(transactions: Transaction[]): MonthlyBreakdown[] {
  const byMonth = groupByMonth(transactions);
  const result: MonthlyBreakdown[] = [];
  for (const [month, txns] of byMonth) {
    result.push({ month, total: sumAmounts(txns) });
  }
  return result.sort((a, b) => a.month.localeCompare(b.month));
}

export function countWeeks(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const diffMs = end.getTime() - start.getTime();
  const weeks = diffMs / (7 * 24 * 60 * 60 * 1000);
  return Math.max(weeks, 1);
}

export function countMonths(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) + 1;
  return Math.max(months, 1);
}

export function computeTrend(values: number[]): { direction: TrendDirection; percent: number } {
  if (values.length < 2) return { direction: "flat", percent: 0 };

  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);

  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  if (avgFirst === 0 && avgSecond === 0) return { direction: "flat", percent: 0 };
  if (avgFirst === 0) return { direction: "up", percent: 100 };

  const change = ((avgSecond - avgFirst) / avgFirst) * 100;
  const direction: TrendDirection =
    Math.abs(change) < 3 ? "flat" : change > 0 ? "up" : "down";

  return { direction, percent: Math.round(Math.abs(change)) };
}

export function currentMonthKey(): MonthKey {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function daysElapsedInMonth(): number {
  return new Date().getDate();
}

export function daysInCurrentMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
