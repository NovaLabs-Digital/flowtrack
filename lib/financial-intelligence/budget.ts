import type { Transaction, BudgetMap, BudgetAnalysis } from "./types";
import { currentMonthKey, daysElapsedInMonth, daysInCurrentMonth } from "./utils";

export function analyzeBudget(
  transactions: Transaction[],
  budgets: BudgetMap
): BudgetAnalysis {
  const currentMonth = currentMonthKey();
  const thisMonthTxns = transactions.filter(
    (t) => t.type === "expense" && t.date.startsWith(currentMonth)
  );

  const spentByCategory = new Map<string, number>();
  for (const t of thisMonthTxns) {
    spentByCategory.set(t.category, (spentByCategory.get(t.category) ?? 0) + t.amount);
  }

  const elapsed = daysElapsedInMonth();
  const totalDays = daysInCurrentMonth();
  const projectionMultiplier = totalDays / Math.max(elapsed, 1);

  const categories = Object.entries(budgets)
    .filter(([, budget]) => budget > 0)
    .map(([category, budget]) => {
      const spent = spentByCategory.get(category) ?? 0;
      const remaining = budget - spent;
      const percentUsed = Math.round((spent / budget) * 100);
      const status: "under" | "near" | "over" =
        percentUsed > 100 ? "over" : percentUsed >= 80 ? "near" : "under";

      return { category, budget, spent, remaining, percentUsed, status };
    });

  const overBudget = categories.filter((c) => c.status === "over").map((c) => c.category);
  const underBudget = categories.filter((c) => c.status === "under").map((c) => c.category);

  const projectedEndOfMonth = categories.map((c) => {
    const projected = Math.round(c.spent * projectionMultiplier);
    return {
      category: c.category,
      projected,
      budget: c.budget,
      willExceed: projected > c.budget,
    };
  });

  return {
    categories,
    overBudget,
    underBudget,
    projectedEndOfMonth,
  };
}
