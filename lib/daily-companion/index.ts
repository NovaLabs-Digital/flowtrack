export type {
  EmailType,
  BillDue,
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  CongratulationsReport,
  WelcomeReport,
  Feedback48hReport,
  Checkin7dReport,
} from "./types";

export { buildDailyReport } from "./daily-report";

export {
  buildGoodMorningEmail,
  buildCongratulationsEmail,
  buildWeeklyEmail,
  buildMonthlyEmail,
  buildWelcomeEmail,
  buildFeedback48hEmail,
  buildCheckin7dEmail,
} from "./email-builder";
export type { BuiltEmail } from "./email-builder";

export {
  renderGoodMorning,
  renderBillReminder,
  renderCongratulations,
  renderWeeklyProgress,
  renderMonthlyProgress,
  renderWelcome,
  renderFeedback48h,
  renderCheckin7d,
} from "./email-templates";

export { sendEmail, getResend } from "./scheduler";
export type { SendEmailOptions } from "./scheduler";
