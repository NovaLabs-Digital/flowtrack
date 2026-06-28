export type TransactionType = "income" | "expense";

export type Transaction = {
  id: string;
  date: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string | null;
};

export type BudgetMap = Record<string, number>;

export type MonthKey = string; // "2026-01", "2026-02", etc.

export type MonthlyBreakdown = {
  month: MonthKey;
  total: number;
};

export type CategoryBreakdown = {
  category: string;
  total: number;
  count: number;
  avgPerTransaction: number;
  percentOfTotal: number;
};

export type TrendDirection = "up" | "down" | "flat";

export type InsightType =
  | "spending_alert"
  | "savings_win"
  | "budget_warning"
  | "income_growth"
  | "income_drop"
  | "recurring_bill"
  | "debt_opportunity"
  | "unusual_purchase"
  | "category_trend"
  | "monthly_summary"
  | "cash_flow_warning";

export type Insight = {
  type: InsightType;
  priority: number;
  title: string;
  payload: Record<string, unknown>;
};

export type IncomeAnalysis = {
  total: number;
  avgMonthly: number;
  avgWeekly: number;
  highestMonth: MonthlyBreakdown | null;
  lowestMonth: MonthlyBreakdown | null;
  trend: TrendDirection;
  trendPercent: number;
  consistency: number; // 0-100, how stable income is across months
  monthlyBreakdown: MonthlyBreakdown[];
};

export type ExpenseAnalysis = {
  total: number;
  avgMonthly: number;
  avgWeekly: number;
  topCategories: CategoryBreakdown[];
  categoryRanking: CategoryBreakdown[];
  categoryGrowth: { category: string; changePercent: number; direction: TrendDirection }[];
  recurringExpenses: { category: string; avgAmount: number; frequency: number }[];
  unusualExpenses: Transaction[];
  monthlyBreakdown: MonthlyBreakdown[];
  trend: TrendDirection;
  trendPercent: number;
};

export type SavingsAnalysis = {
  savingsRate: number;
  avgMonthlySavings: number;
  bestMonth: MonthlyBreakdown | null;
  worstMonth: MonthlyBreakdown | null;
  trend: TrendDirection;
  trendPercent: number;
  monthlyBreakdown: MonthlyBreakdown[];
};

export type BudgetAnalysis = {
  categories: {
    category: string;
    budget: number;
    spent: number;
    remaining: number;
    percentUsed: number;
    status: "under" | "near" | "over";
  }[];
  overBudget: string[];
  underBudget: string[];
  projectedEndOfMonth: {
    category: string;
    projected: number;
    budget: number;
    willExceed: boolean;
  }[];
};

export type CashFlowAnalysis = {
  currentNet: number;
  avgMonthlyNet: number;
  projectedMonthlyNet: number;
  discretionarySpending: number;
  trend: TrendDirection;
  trendPercent: number;
  monthlyBreakdown: MonthlyBreakdown[];
};

export type FinancialReport = {
  income: IncomeAnalysis;
  expenses: ExpenseAnalysis;
  savings: SavingsAnalysis;
  budget: BudgetAnalysis;
  cashFlow: CashFlowAnalysis;
  insights: Insight[];
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
};
