export type EmailType =
  | "good_morning"
  | "bill_reminder"
  | "congratulations"
  | "weekly_progress"
  | "monthly_progress";

export type BillDue = {
  name: string;
  dueLabel: string;
  minimumPayment: number;
  recommendedPayment: number;
  freedomDaysGained: number;
  balance: number;
};

export type DailyReport = {
  userName: string;
  userEmail: string;
  emailType: EmailType;
  greeting: string;
  bills: BillDue[];
  freedomDate: string;
  freedomDaysGained: number;
  debtRemaining: number;
  progressPercent: number;
  encouragement: string;
  generatedAt: string;
};

export type WeeklyReport = {
  userName: string;
  userEmail: string;
  emailType: "weekly_progress";
  periodLabel: string;
  totalIncome: number;
  totalExpenses: number;
  debtReduced: number;
  interestAvoided: number;
  freedomDaysGained: number;
  bestDecision: string;
  suggestion: string;
  freedomDate: string;
  encouragement: string;
  generatedAt: string;
};

export type MonthlyReport = {
  userName: string;
  userEmail: string;
  emailType: "monthly_progress";
  monthLabel: string;
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  debtReduced: number;
  freedomDateMovement: number;
  freedomDate: string;
  progressPercent: number;
  encouragement: string;
  generatedAt: string;
};

export type CongratulationsReport = {
  userName: string;
  userEmail: string;
  emailType: "congratulations";
  achievement: string;
  detail: string;
  freedomDate: string;
  encouragement: string;
  generatedAt: string;
};
