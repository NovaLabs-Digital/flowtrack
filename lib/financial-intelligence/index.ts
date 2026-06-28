import type { Transaction, BudgetMap, FinancialReport } from "./types";
import { analyzeIncome } from "./income";
import { analyzeExpenses } from "./expenses";
import { analyzeSavings } from "./savings";
import { analyzeBudget } from "./budget";
import { analyzeCashFlow } from "./cashflow";
import { generateInsights } from "./insights";

export type { FinancialReport, Insight, Transaction, BudgetMap } from "./types";

export function generateFinancialReport(
  transactions: Transaction[],
  budgets: BudgetMap,
  periodStart: string,
  periodEnd: string
): FinancialReport {
  const income = analyzeIncome(transactions, periodStart, periodEnd);
  const expenses = analyzeExpenses(transactions, periodStart, periodEnd);
  const savings = analyzeSavings(transactions, periodStart, periodEnd);
  const budget = analyzeBudget(transactions, budgets);
  const cashFlow = analyzeCashFlow(transactions, periodStart, periodEnd);
  const insights = generateInsights(income, expenses, savings, budget, cashFlow);

  return {
    income,
    expenses,
    savings,
    budget,
    cashFlow,
    insights,
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
  };
}
