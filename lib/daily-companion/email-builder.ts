import type {
  DailyReport,
  CongratulationsReport,
  WeeklyReport,
  MonthlyReport,
  WelcomeReport,
  Feedback48hReport,
  Checkin7dReport,
  LaunchCohortWelcomeReport,
  LaunchCohortStoryReport,
  LaunchCohortRoutineReport,
  LaunchCohortCheckinReport,
} from "./types";
import {
  renderGoodMorning,
  renderBillReminder,
  renderCongratulations,
  renderWeeklyProgress,
  renderMonthlyProgress,
  renderWelcome,
  renderFeedback48h,
  renderCheckin7d,
  renderLaunchCohortWelcome,
  renderLaunchCohortStory,
  renderLaunchCohortRoutine,
  renderLaunchCohortCheckin,
} from "./email-templates";

export type BuiltEmail = {
  to: string;
  subject: string;
  html: string;
  // Both optional and additive — every existing call site that builds a
  // 3-field BuiltEmail is unaffected.
  text?: string;
  replyTo?: string;
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

// Signup lifecycle emails. All three set replyTo to FlowTrack's support
// address (never the sender's own default), per the requirement that
// replies reach a mailbox Alberto actually reads.
const LIFECYCLE_REPLY_TO = "support@appflowtrack.com";

export function buildWelcomeEmail(report: WelcomeReport): BuiltEmail {
  const rendered = renderWelcome(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LIFECYCLE_REPLY_TO,
  };
}

export function buildFeedback48hEmail(report: Feedback48hReport): BuiltEmail {
  const rendered = renderFeedback48h(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LIFECYCLE_REPLY_TO,
  };
}

export function buildCheckin7dEmail(report: Checkin7dReport): BuiltEmail {
  const rendered = renderCheckin7d(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LIFECYCLE_REPLY_TO,
  };
}

// Launch cohort emails (lib/launch-cohort/) — the same support reply-to as
// the signup lifecycle sequence, since both ultimately land in the mailbox
// Alberto actually reads. Kept as a separate constant reference (same
// value, not a shared import) so the two campaigns' builder functions stay
// independently editable without coupling one's constant to the other's.
const LAUNCH_COHORT_REPLY_TO = "support@appflowtrack.com";

export function buildLaunchCohortWelcomeEmail(report: LaunchCohortWelcomeReport): BuiltEmail {
  const rendered = renderLaunchCohortWelcome(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LAUNCH_COHORT_REPLY_TO,
  };
}

export function buildLaunchCohortStoryEmail(report: LaunchCohortStoryReport): BuiltEmail {
  const rendered = renderLaunchCohortStory(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LAUNCH_COHORT_REPLY_TO,
  };
}

export function buildLaunchCohortRoutineEmail(report: LaunchCohortRoutineReport): BuiltEmail {
  const rendered = renderLaunchCohortRoutine(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LAUNCH_COHORT_REPLY_TO,
  };
}

export function buildLaunchCohortCheckinEmail(report: LaunchCohortCheckinReport): BuiltEmail {
  const rendered = renderLaunchCohortCheckin(report);
  return {
    to: report.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: LAUNCH_COHORT_REPLY_TO,
  };
}
