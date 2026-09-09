import type {
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  CongratulationsReport,
  WelcomeReport,
  Feedback48hReport,
  Checkin7dReport,
} from "./types";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FlowTrack</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]>
<table role="presentation" width="592" cellpadding="0" cellspacing="0" align="center"><tr><td>
<![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:592px;background:#0f172a;border-radius:20px;">
<tr><td style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">

<!-- Header -->
<tr><td style="padding:24px 28px 16px;border-bottom:1px solid #334155;">
<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#64748b;">FlowTrack</div>
<div style="font-size:18px;font-weight:600;color:#f1f5f9;margin-top:4px;">Daily Companion</div>
</td></tr>

<!-- Content -->
<tr><td style="padding:24px 28px;">
${content}
</td></tr>

<!-- Footer -->
<tr><td style="padding:16px 28px 24px;border-top:1px solid #334155;">
<div style="font-size:11px;color:#475569;line-height:1.6;">
— Your FlowTrack Companion<br/>
<span style="color:#334155;">See it. Measure it. Control it.</span>
</div>
</td></tr>

</table>
</td></tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Renders the "Payment source: Name •••• 1234" line for a bill card. Never
// trusts that a stored last4 is actually 4 digits — re-validates here so a
// malformed value can never leak more than four characters into an email.
function paymentSourceLine(name: string | null, last4: string | null): string {
  const safeName = name && name.trim() ? escapeHtml(name.trim()) : null;
  const safeLast4 = last4 && /^\d{4}$/.test(last4) ? last4 : null;

  if (!safeName && !safeLast4) return "";

  const label = safeName && safeLast4
    ? `${safeName} •••• ${safeLast4}`
    : safeName
    ? safeName
    : `•••• ${safeLast4}`;

  return `
<div style="font-size:11px;color:#64748b;margin-top:8px;padding-top:8px;border-top:1px solid #334155;">Payment source: ${label}</div>`;
}

function billRow(
  name: string,
  dueLabel: string,
  minimum: number,
  recommended: number,
  freedomDays: number,
  paymentSourceName: string | null = null,
  paymentSourceLast4: string | null = null
): string {
  const hasExtra = recommended > minimum;
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-bottom:12px;">
<tr><td style="padding:16px;">
<div style="display:flex;justify-content:space-between;align-items:center;">
<div>
<div style="font-size:14px;font-weight:600;color:#f1f5f9;">${name}</div>
<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${dueLabel}</div>
</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
<tr>
<td style="font-size:11px;color:#94a3b8;padding:3px 0;">Minimum</td>
<td style="font-size:11px;color:#e2e8f0;text-align:right;padding:3px 0;">${formatCurrency(minimum)}</td>
</tr>
${hasExtra ? `<tr>
<td style="font-size:11px;color:#94a3b8;padding:3px 0;">Recommended</td>
<td style="font-size:11px;font-weight:600;color:#34d399;text-align:right;padding:3px 0;">${formatCurrency(recommended)}</td>
</tr>` : ""}
${freedomDays > 0 ? `<tr>
<td colspan="2" style="font-size:11px;color:#34d399;padding:8px 0 0;border-top:1px solid #334155;margin-top:8px;">
Making the recommended payment moves your Financial Freedom Date ${freedomDays} days closer.
</td>
</tr>` : ""}
</table>
${paymentSourceLine(paymentSourceName, paymentSourceLast4)}
</td></tr>
</table>`;
}

export function renderGoodMorning(report: DailyReport): { subject: string; html: string } {
  const billsHtml = report.bills.length > 0
    ? `<div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Today's Priorities</div>
${report.bills.map((b) => billRow(b.name, b.dueLabel, b.minimumPayment, b.recommendedPayment, b.freedomDaysGained, b.paymentSourceName, b.paymentSourceLast4)).join("")}`
    : `<div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">No bills need attention today. You're on track.</div>`;

  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:20px;">${report.greeting}</div>
<div style="font-size:13px;color:#94a3b8;margin-bottom:20px;">Here are today's priorities.</div>
${billsHtml}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-top:16px;">
<tr><td style="padding:16px;">
<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:6px;">Financial Freedom Date</div>
<div style="font-size:18px;font-weight:700;color:#34d399;">${report.freedomDate}</div>
${report.progressPercent > 0 ? `<div style="margin-top:8px;height:6px;background:#1e293b;border-radius:3px;overflow:hidden;border:1px solid #334155;">
<div style="height:100%;width:${report.progressPercent}%;background:linear-gradient(90deg,#10b981,#14b8a6);border-radius:3px;"></div>
</div>
<div style="font-size:10px;color:#64748b;margin-top:4px;">${report.progressPercent}% complete</div>` : ""}
</td></tr>
</table>
<div style="font-size:13px;color:#94a3b8;margin-top:20px;line-height:1.6;">${report.encouragement}</div>`;

  return {
    subject: `Good Morning, ${report.userName}`,
    html: baseLayout(content),
  };
}

export function renderBillReminder(report: DailyReport): { subject: string; html: string } {
  const bill = report.bills[0];
  if (!bill) return renderGoodMorning(report);

  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:16px;">${report.greeting}</div>
${billRow(bill.name, bill.dueLabel, bill.minimumPayment, bill.recommendedPayment, bill.freedomDaysGained, bill.paymentSourceName, bill.paymentSourceLast4)}
<div style="font-size:13px;color:#94a3b8;margin-top:16px;line-height:1.6;">${report.encouragement}</div>`;

  return {
    subject: `${bill.name} — ${bill.dueLabel}`,
    html: baseLayout(content),
  };
}

export function renderCongratulations(report: CongratulationsReport): { subject: string; html: string } {
  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:16px;">Great news, ${report.userName}.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#064e3b;border-radius:12px;border:1px solid #059669;margin-bottom:16px;">
<tr><td style="padding:20px;text-align:center;">
<div style="font-size:16px;font-weight:700;color:#34d399;">${report.achievement}</div>
<div style="font-size:12px;color:#a7f3d0;margin-top:6px;">${report.detail}</div>
</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;">
<tr><td style="padding:16px;">
<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:6px;">Financial Freedom Date</div>
<div style="font-size:18px;font-weight:700;color:#34d399;">${report.freedomDate}</div>
</td></tr>
</table>
<div style="font-size:13px;color:#94a3b8;margin-top:20px;line-height:1.6;">${report.encouragement}</div>`;

  return {
    subject: `${report.achievement}`,
    html: baseLayout(content),
  };
}

export function renderWeeklyProgress(report: WeeklyReport): { subject: string; html: string } {
  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:8px;">Here's your week in review, ${report.userName}.</div>
<div style="font-size:11px;color:#64748b;margin-bottom:20px;">${report.periodLabel}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-bottom:16px;">
<tr><td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Income</td>
<td style="font-size:11px;color:#34d399;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.totalIncome)}</td>
</tr>
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Expenses</td>
<td style="font-size:11px;color:#f87171;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.totalExpenses)}</td>
</tr>
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Debt Reduced</td>
<td style="font-size:11px;color:#34d399;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.debtReduced)}</td>
</tr>
${report.freedomDaysGained > 0 ? `<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Freedom Days Gained</td>
<td style="font-size:11px;color:#34d399;text-align:right;padding:4px 0;font-weight:600;">+${report.freedomDaysGained} days</td>
</tr>` : ""}
</table>
</td></tr>
</table>
${report.bestDecision ? `<div style="font-size:12px;color:#e2e8f0;margin-bottom:8px;"><strong>Best decision:</strong> ${report.bestDecision}</div>` : ""}
${report.suggestion ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:16px;"><strong>Next step:</strong> ${report.suggestion}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;">
<tr><td style="padding:16px;">
<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:6px;">Financial Freedom Date</div>
<div style="font-size:18px;font-weight:700;color:#34d399;">${report.freedomDate}</div>
</td></tr>
</table>
<div style="font-size:13px;color:#94a3b8;margin-top:20px;line-height:1.6;">${report.encouragement}</div>`;

  return {
    subject: `Your Week in Review, ${report.userName}`,
    html: baseLayout(content),
  };
}

export function renderMonthlyProgress(report: MonthlyReport): { subject: string; html: string } {
  const netColor = report.netSavings >= 0 ? "#34d399" : "#f87171";
  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:8px;">Your month at a glance, ${report.userName}.</div>
<div style="font-size:11px;color:#64748b;margin-bottom:20px;">${report.monthLabel}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-bottom:16px;">
<tr><td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Income</td>
<td style="font-size:11px;color:#34d399;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.totalIncome)}</td>
</tr>
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Expenses</td>
<td style="font-size:11px;color:#f87171;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.totalExpenses)}</td>
</tr>
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;border-top:1px solid #334155;">Net Savings</td>
<td style="font-size:11px;color:${netColor};text-align:right;padding:4px 0;font-weight:600;border-top:1px solid #334155;">${formatCurrency(report.netSavings)}</td>
</tr>
<tr>
<td style="font-size:11px;color:#94a3b8;padding:4px 0;">Debt Reduced</td>
<td style="font-size:11px;color:#34d399;text-align:right;padding:4px 0;font-weight:600;">${formatCurrency(report.debtReduced)}</td>
</tr>
</table>
</td></tr>
</table>
${report.progressPercent > 0 ? `<div style="margin-bottom:16px;">
<div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden;border:1px solid #334155;">
<div style="height:100%;width:${report.progressPercent}%;background:linear-gradient(90deg,#10b981,#14b8a6);border-radius:3px;"></div>
</div>
<div style="font-size:10px;color:#64748b;margin-top:4px;">${report.progressPercent}% toward Financial Freedom</div>
</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;">
<tr><td style="padding:16px;">
<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:6px;">Financial Freedom Date</div>
<div style="font-size:18px;font-weight:700;color:#34d399;">${report.freedomDate}</div>
${report.freedomDateMovement > 0 ? `<div style="font-size:11px;color:#34d399;margin-top:4px;">Moved ${report.freedomDateMovement} days closer this month</div>` : ""}
</td></tr>
</table>
<div style="font-size:13px;color:#94a3b8;margin-top:20px;line-height:1.6;">${report.encouragement}</div>`;

  return {
    subject: `Monthly Progress — ${report.monthLabel}`,
    html: baseLayout(content),
  };
}

// Signup lifecycle emails (Welcome, ~48h feedback, 7-day check-in) — all
// three are deliberately plain: no financial data, no promotional content,
// a single short ask/CTA, and (for the two follow-ups) a visible STOP line.
// Each also returns a `text` plain-text alternative, since these are the
// first emails a brand-new user receives and are the most likely to be
// read in a plain-text-preferring client.

function firstNameOf(userName: string): string {
  return userName.split(" ")[0] || userName || "there";
}

export function renderWelcome(report: WelcomeReport): { subject: string; html: string; text: string } {
  const name = escapeHtml(firstNameOf(report.userName));
  const safeUrl = escapeHtml(report.dashboardUrl);

  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:16px;">Welcome to FlowTrack, ${name}.</div>
<div style="font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.6;">
You just took the first step toward seeing exactly where your money goes. FlowTrack is built around one idea:
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-bottom:20px;">
<tr><td style="padding:16px;text-align:center;">
<div style="font-size:14px;font-weight:600;color:#34d399;">See it. Measure it. Control it.</div>
</td></tr>
</table>
<div style="font-size:13px;color:#94a3b8;margin-bottom:24px;line-height:1.6;">
Add your income and a few expenses, and your dashboard will start showing you the real picture right away.
</div>
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="border-radius:10px;background:#10b981;">
<a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-size:13px;font-weight:600;color:#052e1f;text-decoration:none;">Continue setup</a>
</td></tr>
</table>
<div style="font-size:12px;color:#64748b;margin-top:24px;line-height:1.6;">
Questions along the way? Just reply to this email — it reaches our support team directly.
</div>`;

  return {
    subject: `Welcome to FlowTrack, ${firstNameOf(report.userName)}`,
    html: baseLayout(content),
    text: `Welcome to FlowTrack, ${firstNameOf(report.userName)}.

You just took the first step toward seeing exactly where your money goes. FlowTrack is built around one idea: See it. Measure it. Control it.

Add your income and a few expenses, and your dashboard will start showing you the real picture right away.

Continue setup: ${report.dashboardUrl}

Questions along the way? Just reply to this email — it reaches our support team directly.`,
  };
}

export function renderFeedback48h(report: Feedback48hReport): { subject: string; html: string; text: string } {
  const name = escapeHtml(firstNameOf(report.userName));

  const questions = [
    "Did the landing page clearly explain what FlowTrack does?",
    "Did signing up and getting started feel simple?",
    "Did the dashboard help you understand your finances?",
    "What felt confusing, if anything?",
    "Could you see yourself coming back weekly?",
  ];

  const questionsHtml = questions
    .map(
      (q, i) =>
        `<div style="font-size:13px;color:#e2e8f0;padding:8px 0;${i > 0 ? "border-top:1px solid #334155;" : ""}">${i + 1}. ${escapeHtml(q)}</div>`
    )
    .join("");

  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:12px;">Hi ${name}, quick question.</div>
<div style="font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.6;">
You've had a couple of days with FlowTrack. Alberto (the person building it) personally reads every reply — five quick questions, whenever you have a minute:
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;margin-bottom:20px;">
<tr><td style="padding:16px;">
${questionsHtml}
</td></tr>
</table>
<div style="font-size:13px;color:#e2e8f0;line-height:1.6;">
Just hit reply — that's the whole process, no forms or surveys.
</div>
<div style="font-size:11px;color:#475569;margin-top:24px;line-height:1.6;">
Reply STOP if you don't want additional FlowTrack check-ins.
</div>`;

  return {
    subject: "Quick question about your FlowTrack experience",
    html: baseLayout(content),
    text: `Hi ${firstNameOf(report.userName)}, quick question.

You've had a couple of days with FlowTrack. Alberto (the person building it) personally reads every reply — five quick questions, whenever you have a minute:

${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Just hit reply — that's the whole process, no forms or surveys.

Reply STOP if you don't want additional FlowTrack check-ins.`,
  };
}

export function renderCheckin7d(report: Checkin7dReport): { subject: string; html: string; text: string } {
  const name = escapeHtml(firstNameOf(report.userName));

  const content = `
<div style="font-size:15px;color:#e2e8f0;margin-bottom:16px;">Hi ${name}, checking in.</div>
<div style="font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.6;">
You've been using FlowTrack for about a week now. If anything is blocking you or feels confusing, we'd genuinely like to help — just reply to this email, or open Help from inside your dashboard.
</div>
<div style="font-size:13px;color:#94a3b8;line-height:1.6;">
No pressure either way — just wanted to check in.
</div>
<div style="font-size:11px;color:#475569;margin-top:24px;line-height:1.6;">
Reply STOP if you don't want additional FlowTrack check-ins.
</div>`;

  return {
    subject: "Checking in — anything blocking you on FlowTrack?",
    html: baseLayout(content),
    text: `Hi ${firstNameOf(report.userName)}, checking in.

You've been using FlowTrack for about a week now. If anything is blocking you or feels confusing, we'd genuinely like to help — just reply to this email, or open Help from inside your dashboard.

No pressure either way — just wanted to check in.

Reply STOP if you don't want additional FlowTrack check-ins.`,
  };
}
