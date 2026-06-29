import type { StrategyType } from "../debt-recovery/types";

export type FinancialFreedomReport = {
  financialFreedomDate: string; // ISO date "YYYY-MM-DD"
  daysRemaining: number;
  monthsRemaining: number;
  yearsRemaining: number;
  currentStrategy: StrategyType;
  totalDebt: number;
  debtRemaining: number;
  projectedInterest: number;
  monthlyDebtPayment: number;
  recommendedExtraPayment: number;
  interestSaved: number;
  monthsSaved: number;
  progressPercent: number;
  monthlySurplus: number;
  generatedAt: string;
};

export type MovementReport = {
  daysMovedForward: number;
  daysMovedBackward: number;
  monthsSaved: number;
  interestSaved: number;
  progressChange: number;
  previousDate: string;
  currentDate: string;
};

export type MilestoneType =
  | "first_debt_paid"
  | "quarter_eliminated"
  | "half_eliminated"
  | "three_quarter_eliminated"
  | "one_year_saved"
  | "two_years_saved"
  | "debt_free";

export type Milestone = {
  type: MilestoneType;
  title: string;
  achieved: boolean;
  progressPercent: number;
};

export type TimelineEntry = {
  month: string; // "YYYY-MM"
  debtRemaining: number;
  interestPaid: number;
  principalPaid: number;
  debtsActive: number;
};

export type FreedomTimeline = {
  entries: TimelineEntry[];
  totalMonths: number;
  totalInterest: number;
  totalPrincipal: number;
};
