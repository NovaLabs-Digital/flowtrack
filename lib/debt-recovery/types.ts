export type DebtType =
  | "credit_card"
  | "mortgage"
  | "auto_loan"
  | "student_loan"
  | "personal_loan"
  | "line_of_credit"
  | "medical_debt"
  | "other";

export type DebtStatus = "open" | "paid_off";

export type PaymentPlan = "minimum" | "custom";

export type ReminderMethod = "email" | "sms" | "both";
export type ReminderOffset = 1 | 3 | 7;

export type Debt = {
  id: string;
  user_id: string;
  name: string;
  type: DebtType;
  balance: number;
  apr: number;
  minimum_payment: number;
  due_day: number; // day of month (1-31)
  payment_plan: PaymentPlan;
  custom_payment: number | null;
  status: DebtStatus;
  notes: string | null;
  last_payment_date: string | null;
  reminder_enabled: boolean;
  reminder_method: ReminderMethod | null;
  reminder_offset: ReminderOffset | null;
  created_at: string;
};

export type DebtSummary = {
  totalDebt: number;
  weightedAvgApr: number;
  totalMinimumPayments: number;
  estimatedMonthlyInterest: number;
  debtCount: number;
  openDebtCount: number;
};

export type StrategyType = "avalanche" | "snowball" | "custom";

export type DebtPayoffSchedule = {
  debtId: string;
  debtName: string;
  startBalance: number;
  monthsToPayoff: number;
  totalInterestPaid: number;
  totalPaid: number;
  payoffDate: string; // "YYYY-MM"
};

export type StrategyResult = {
  strategy: StrategyType;
  schedules: DebtPayoffSchedule[];
  totalMonths: number;
  totalInterest: number;
  totalPaid: number;
  debtFreeDate: string;
};

export type StrategyComparison = {
  avalanche: StrategyResult;
  snowball: StrategyResult;
  recommendedStrategy: StrategyType;
  monthsSaved: number;
  interestSaved: number;
  recommendedExtraPayment: number;
};
