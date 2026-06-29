export type {
  EmailType,
  BillDue,
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  CongratulationsReport,
} from "./types";

export { buildDailyReport } from "./daily-report";

export {
  buildGoodMorningEmail,
  buildCongratulationsEmail,
  buildWeeklyEmail,
  buildMonthlyEmail,
} from "./email-builder";
export type { BuiltEmail } from "./email-builder";

export {
  renderGoodMorning,
  renderBillReminder,
  renderCongratulations,
  renderWeeklyProgress,
  renderMonthlyProgress,
} from "./email-templates";

export { sendEmail } from "./scheduler";
