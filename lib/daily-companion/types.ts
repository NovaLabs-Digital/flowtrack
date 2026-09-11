export type EmailType =
  | "good_morning"
  | "bill_reminder"
  | "congratulations"
  | "weekly_progress"
  | "monthly_progress"
  | "welcome"
  | "feedback_48h"
  | "checkin_7d"
  | "launch_cohort_welcome"
  | "launch_cohort_story"
  | "launch_cohort_routine"
  | "launch_cohort_checkin";

export type BillDue = {
  name: string;
  dueLabel: string;
  minimumPayment: number;
  recommendedPayment: number;
  freedomDaysGained: number;
  balance: number;
  paymentSourceName: string | null;
  paymentSourceLast4: string | null;
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

// The three signup lifecycle emails (Welcome, ~48h feedback, 7-day
// check-in). Deliberately minimal — no debt/freedom-date fields, since
// these are account-guidance/feedback emails, not financial progress
// reports.
export type WelcomeReport = {
  userName: string;
  userEmail: string;
  emailType: "welcome";
  // Absolute URL for the primary CTA button. Passed in rather than read
  // from an env var inside the template, so this file stays pure/testable.
  dashboardUrl: string;
  generatedAt: string;
};

export type Feedback48hReport = {
  userName: string;
  userEmail: string;
  emailType: "feedback_48h";
  generatedAt: string;
};

export type Checkin7dReport = {
  userName: string;
  userEmail: string;
  emailType: "checkin_7d";
  generatedAt: string;
};

// The four one-time "launch cohort" emails sent to an explicitly-approved
// cohort of existing external users (lib/launch-cohort/), scheduled from a
// single campaign start time rather than each user's own signup date. A
// deliberately separate email-type namespace from the three above (never
// "welcome" etc.) so this one-time campaign can never be confused with, or
// accidentally merged into, the ongoing signup lifecycle sequence.
export type LaunchCohortWelcomeReport = {
  userName: string;
  userEmail: string;
  emailType: "launch_cohort_welcome";
  dashboardUrl: string;
  generatedAt: string;
};

export type LaunchCohortStoryReport = {
  userName: string;
  userEmail: string;
  emailType: "launch_cohort_story";
  dashboardUrl: string;
  generatedAt: string;
};

export type LaunchCohortRoutineReport = {
  userName: string;
  userEmail: string;
  emailType: "launch_cohort_routine";
  dashboardUrl: string;
  generatedAt: string;
};

export type LaunchCohortCheckinReport = {
  userName: string;
  userEmail: string;
  emailType: "launch_cohort_checkin";
  generatedAt: string;
};
