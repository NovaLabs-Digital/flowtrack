import type {
  Insight,
  IncomeAnalysis,
  ExpenseAnalysis,
  SavingsAnalysis,
  BudgetAnalysis,
  CashFlowAnalysis,
} from "./types";

export function generateInsights(
  income: IncomeAnalysis,
  expenses: ExpenseAnalysis,
  savings: SavingsAnalysis,
  budget: BudgetAnalysis,
  cashFlow: CashFlowAnalysis
): Insight[] {
  const insights: Insight[] = [];

  // --- INCOME ---

  if (income.trend === "up" && income.trendPercent >= 10) {
    insights.push({
      type: "income_growth",
      priority: 75,
      title: "Income trending up",
      payload: {
        direction: income.trend,
        changePercent: income.trendPercent,
        avgMonthly: income.avgMonthly,
      },
    });
  }

  if (income.trend === "down" && income.trendPercent >= 10) {
    insights.push({
      type: "income_drop",
      priority: 85,
      title: "Income trending down",
      payload: {
        direction: income.trend,
        changePercent: income.trendPercent,
        avgMonthly: income.avgMonthly,
      },
    });
  }

  if (income.consistency < 50 && income.monthlyBreakdown.length >= 2) {
    insights.push({
      type: "income_drop",
      priority: 60,
      title: "Inconsistent income",
      payload: {
        consistency: income.consistency,
        highestMonth: income.highestMonth,
        lowestMonth: income.lowestMonth,
      },
    });
  }

  // --- EXPENSES ---

  if (expenses.topCategories.length > 0) {
    const top = expenses.topCategories[0];
    if (top.percentOfTotal >= 40) {
      insights.push({
        type: "spending_alert",
        priority: 80,
        title: "Single category dominates spending",
        payload: {
          category: top.category,
          amount: top.total,
          percentOfTotal: top.percentOfTotal,
        },
      });
    }
  }

  for (const growth of expenses.categoryGrowth) {
    if (growth.direction === "up" && growth.changePercent >= 25) {
      insights.push({
        type: "category_trend",
        priority: 70 + Math.min(growth.changePercent / 5, 20),
        title: "Category spending increasing",
        payload: {
          category: growth.category,
          changePercent: growth.changePercent,
          direction: growth.direction,
        },
      });
    }
  }

  for (const unusual of expenses.unusualExpenses.slice(0, 3)) {
    insights.push({
      type: "unusual_purchase",
      priority: 65,
      title: "Unusual expense detected",
      payload: {
        amount: unusual.amount,
        category: unusual.category,
        date: unusual.date,
        description: unusual.description,
      },
    });
  }

  for (const recurring of expenses.recurringExpenses.slice(0, 3)) {
    insights.push({
      type: "recurring_bill",
      priority: 40,
      title: "Recurring expense identified",
      payload: {
        category: recurring.category,
        avgAmount: recurring.avgAmount,
        frequency: recurring.frequency,
      },
    });
  }

  if (expenses.trend === "up" && expenses.trendPercent >= 15) {
    insights.push({
      type: "spending_alert",
      priority: 82,
      title: "Overall spending trending up",
      payload: {
        direction: expenses.trend,
        changePercent: expenses.trendPercent,
        avgMonthly: expenses.avgMonthly,
      },
    });
  }

  // --- SAVINGS ---

  if (savings.savingsRate >= 20) {
    insights.push({
      type: "savings_win",
      priority: 55,
      title: "Strong savings rate",
      payload: {
        savingsRate: savings.savingsRate,
        avgMonthlySavings: savings.avgMonthlySavings,
      },
    });
  }

  if (savings.savingsRate < 0) {
    insights.push({
      type: "spending_alert",
      priority: 95,
      title: "Negative savings rate",
      payload: {
        savingsRate: savings.savingsRate,
        avgMonthlySavings: savings.avgMonthlySavings,
      },
    });
  }

  if (savings.trend === "up" && savings.trendPercent >= 10) {
    insights.push({
      type: "savings_win",
      priority: 50,
      title: "Savings trend improving",
      payload: {
        direction: savings.trend,
        changePercent: savings.trendPercent,
      },
    });
  }

  // --- BUDGET ---

  for (const cat of budget.overBudget) {
    const entry = budget.categories.find((c) => c.category === cat);
    insights.push({
      type: "budget_warning",
      priority: 88,
      title: "Over budget",
      payload: {
        category: cat,
        budget: entry?.budget ?? 0,
        spent: entry?.spent ?? 0,
        percentUsed: entry?.percentUsed ?? 0,
      },
    });
  }

  for (const proj of budget.projectedEndOfMonth) {
    if (proj.willExceed) {
      const existing = budget.overBudget.includes(proj.category);
      if (!existing) {
        insights.push({
          type: "budget_warning",
          priority: 78,
          title: "Projected to exceed budget",
          payload: {
            category: proj.category,
            projected: proj.projected,
            budget: proj.budget,
          },
        });
      }
    }
  }

  // --- CASH FLOW ---

  if (cashFlow.currentNet < 0) {
    insights.push({
      type: "cash_flow_warning",
      priority: 96,
      title: "Negative cash flow",
      payload: {
        currentNet: cashFlow.currentNet,
        avgMonthlyNet: cashFlow.avgMonthlyNet,
      },
    });
  }

  if (cashFlow.discretionarySpending > 0 && cashFlow.currentNet > 0) {
    insights.push({
      type: "debt_opportunity",
      priority: 45,
      title: "Discretionary funds available",
      payload: {
        discretionarySpending: cashFlow.discretionarySpending,
        currentNet: cashFlow.currentNet,
        projectedMonthlyNet: cashFlow.projectedMonthlyNet,
      },
    });
  }

  if (cashFlow.projectedMonthlyNet < 0 && cashFlow.currentNet >= 0) {
    insights.push({
      type: "cash_flow_warning",
      priority: 85,
      title: "Projected negative month-end",
      payload: {
        projectedMonthlyNet: cashFlow.projectedMonthlyNet,
        currentNet: cashFlow.currentNet,
      },
    });
  }

  // --- MONTHLY SUMMARY ---

  if (income.total > 0 || expenses.total > 0) {
    insights.push({
      type: "monthly_summary",
      priority: 30,
      title: "Period summary",
      payload: {
        totalIncome: income.total,
        totalExpenses: expenses.total,
        netSavings: income.total - expenses.total,
        savingsRate: savings.savingsRate,
        topCategory: expenses.topCategories[0]?.category ?? null,
        topCategoryAmount: expenses.topCategories[0]?.total ?? 0,
      },
    });
  }

  return insights.sort((a, b) => b.priority - a.priority);
}
