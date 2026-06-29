import type { DailyReport, CongratulationsReport, WeeklyReport, MonthlyReport } from "./types";
import {
  renderGoodMorning,
  renderBillReminder,
  renderCongratulations,
  renderWeeklyProgress,
  renderMonthlyProgress,
} from "./email-templates";

export type BuiltEmail = {
  to: string;
  subject: string;
  html: string;
};

export function buildGoodMorningEmail(report: DailyReport): BuiltEmail {
  const hasBills = report.bills.length > 0;
  const rendered = hasBills && report.bills.length === 1
    ? renderBillReminder(report)
    : renderGoodMorning(report);

  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
  };
}

export function buildCongratulationsEmail(report: CongratulationsReport): BuiltEmail {
  const rendered = renderCongratulations(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
  };
}

export function buildWeeklyEmail(report: WeeklyReport): BuiltEmail {
  const rendered = renderWeeklyProgress(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
  };
}

export function buildMonthlyEmail(report: MonthlyReport): BuiltEmail {
  const rendered = renderMonthlyProgress(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
  };
}
