import { describe, expect, it } from "vitest";
import {
  renderLaunchCohortWelcome,
  renderLaunchCohortStory,
  renderLaunchCohortRoutine,
  renderLaunchCohortCheckin,
} from "./email-templates";
import {
  buildLaunchCohortWelcomeEmail,
  buildLaunchCohortStoryEmail,
  buildLaunchCohortRoutineEmail,
  buildLaunchCohortCheckinEmail,
} from "./email-builder";
import type {
  LaunchCohortWelcomeReport,
  LaunchCohortStoryReport,
  LaunchCohortRoutineReport,
  LaunchCohortCheckinReport,
} from "./types";

function makeWelcome(overrides: Partial<LaunchCohortWelcomeReport> = {}): LaunchCohortWelcomeReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "launch_cohort_welcome",
    dashboardUrl: "https://www.appflowtrack.com/dashboard",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStory(overrides: Partial<LaunchCohortStoryReport> = {}): LaunchCohortStoryReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "launch_cohort_story",
    dashboardUrl: "https://www.appflowtrack.com/dashboard",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRoutine(overrides: Partial<LaunchCohortRoutineReport> = {}): LaunchCohortRoutineReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "launch_cohort_routine",
    dashboardUrl: "https://www.appflowtrack.com/dashboard",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCheckin(overrides: Partial<LaunchCohortCheckinReport> = {}): LaunchCohortCheckinReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "launch_cohort_checkin",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const PROMO_PATTERNS = [/START25/i, /upgrade/i, /\bpro\b/i, /discount/i, /% off/i];

describe("renderLaunchCohortWelcome (Day 0)", () => {
  it("congratulates the user and reinforces the FlowTrack tagline", () => {
    const { html, text } = renderLaunchCohortWelcome(makeWelcome());
    expect(html).toMatch(/welcome to flowtrack/i);
    expect(html).toContain("See it. Measure it. Control it.");
    expect(text).toContain("See it. Measure it. Control it.");
  });

  it("explains the benefit: see, measure, decide", () => {
    const { html, text } = renderLaunchCohortWelcome(makeWelcome());
    expect(html).toMatch(/see exactly where your money goes/i);
    expect(html).toMatch(/measure your progress/i);
    expect(html).toMatch(/better decisions/i);
    expect(text).toMatch(/see exactly where your money goes/i);
  });

  it("gives exactly three first steps: add income, add expenses, review dashboard", () => {
    const { html, text } = renderLaunchCohortWelcome(makeWelcome());
    expect(html).toMatch(/add your income/i);
    expect(html).toMatch(/add a few expenses/i);
    expect(html).toMatch(/review your dashboard/i);
    expect(text).toMatch(/add your income/i);
    expect(text).toMatch(/add a few expenses/i);
    expect(text).toMatch(/review your dashboard/i);
  });

  it("does not include a STOP suppression line — only the day-21 checkin does", () => {
    const { html, text } = renderLaunchCohortWelcome(makeWelcome());
    expect(html).not.toMatch(/reply stop/i);
    expect(text).not.toMatch(/reply stop/i);
  });

  it("contains no upgrade pressure or promotional language", () => {
    const { html, text } = renderLaunchCohortWelcome(makeWelcome());
    for (const forbidden of PROMO_PATTERNS) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("escapes an HTML-significant name and URL", () => {
    const { html } = renderLaunchCohortWelcome(
      makeWelcome({
        userName: `<img src=x onerror=alert(1)>`,
        dashboardUrl: `https://example.com/"><script>alert(1)</script>`,
      })
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("renderLaunchCohortStory (Day 7)", () => {
  it("explains categories, budgets, and spending patterns", () => {
    const { html, text } = renderLaunchCohortStory(makeStory());
    expect(html).toMatch(/categories/i);
    expect(html).toMatch(/budgets/i);
    expect(html).toMatch(/spending patterns/i);
    expect(text).toMatch(/categories/i);
    expect(text).toMatch(/budgets/i);
  });

  it("asks one easy feedback question about what felt clear or confusing", () => {
    const { html, text } = renderLaunchCohortStory(makeStory());
    expect(html).toMatch(/what felt clear.*confusing/i);
    expect(text).toMatch(/what felt clear.*confusing/i);
  });

  it("does not include a STOP suppression line", () => {
    const { html, text } = renderLaunchCohortStory(makeStory());
    expect(html).not.toMatch(/reply stop/i);
    expect(text).not.toMatch(/reply stop/i);
  });

  it("contains no upgrade pressure or promotional language", () => {
    const { html, text } = renderLaunchCohortStory(makeStory());
    for (const forbidden of PROMO_PATTERNS) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("escapes an HTML-significant name", () => {
    const { html } = renderLaunchCohortStory(makeStory({ userName: `<b>x</b>` }));
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("renderLaunchCohortRoutine (Day 14)", () => {
  it("suggests a 5-10 minute weekly review covering transactions, upcoming bills, and one improvement", () => {
    const { html, text } = renderLaunchCohortRoutine(makeRoutine());
    expect(html).toMatch(/5-10 minutes/i);
    expect(html).toMatch(/transactions/i);
    expect(html).toMatch(/upcoming bills/i);
    expect(html).toMatch(/one small improvement/i);
    expect(text).toMatch(/transactions/i);
    expect(text).toMatch(/upcoming bills/i);
  });

  it("does not include a STOP suppression line", () => {
    const { html, text } = renderLaunchCohortRoutine(makeRoutine());
    expect(html).not.toMatch(/reply stop/i);
    expect(text).not.toMatch(/reply stop/i);
  });

  it("contains no upgrade pressure or promotional language", () => {
    const { html, text } = renderLaunchCohortRoutine(makeRoutine());
    for (const forbidden of PROMO_PATTERNS) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("escapes an HTML-significant name", () => {
    const { html } = renderLaunchCohortRoutine(makeRoutine({ userName: `<b>x</b>` }));
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("renderLaunchCohortCheckin (Day 21)", () => {
  it("asks whether anything is blocking them and invites a reply to support", () => {
    const { html, text } = renderLaunchCohortCheckin(makeCheckin());
    expect(html).toMatch(/blocking/i);
    expect(html).toMatch(/reply/i);
    expect(text).toMatch(/blocking/i);
  });

  it("includes the exact required STOP suppression line", () => {
    const { html, text } = renderLaunchCohortCheckin(makeCheckin());
    expect(html).toContain("Reply STOP if you do not want additional FlowTrack check-ins.");
    expect(text).toContain("Reply STOP if you do not want additional FlowTrack check-ins.");
  });

  it("contains no upgrade pressure or promotional language", () => {
    const { html, text } = renderLaunchCohortCheckin(makeCheckin());
    for (const forbidden of PROMO_PATTERNS) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("escapes an HTML-significant name", () => {
    const { html } = renderLaunchCohortCheckin(makeCheckin({ userName: `<b>x</b>` }));
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("builders: wire replyTo to support@appflowtrack.com and forward the text alternative", () => {
  it("buildLaunchCohortWelcomeEmail sets replyTo and includes html/text", () => {
    const email = buildLaunchCohortWelcomeEmail(makeWelcome());
    expect(email.to).toBe("jordan@example.com");
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text?.length).toBeGreaterThan(0);
  });

  it("buildLaunchCohortStoryEmail sets replyTo and includes html/text", () => {
    const email = buildLaunchCohortStoryEmail(makeStory());
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.text?.length).toBeGreaterThan(0);
  });

  it("buildLaunchCohortRoutineEmail sets replyTo and includes html/text", () => {
    const email = buildLaunchCohortRoutineEmail(makeRoutine());
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.text?.length).toBeGreaterThan(0);
  });

  it("buildLaunchCohortCheckinEmail sets replyTo and includes html/text", () => {
    const email = buildLaunchCohortCheckinEmail(makeCheckin());
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.text?.length).toBeGreaterThan(0);
  });
});
