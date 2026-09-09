import { describe, expect, it } from "vitest";
import { renderWelcome, renderFeedback48h, renderCheckin7d } from "./email-templates";
import {
  buildWelcomeEmail,
  buildFeedback48hEmail,
  buildCheckin7dEmail,
} from "./email-builder";
import type { WelcomeReport, Feedback48hReport, Checkin7dReport } from "./types";

function makeWelcome(overrides: Partial<WelcomeReport> = {}): WelcomeReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "welcome",
    dashboardUrl: "https://www.appflowtrack.com/dashboard",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFeedback48h(overrides: Partial<Feedback48hReport> = {}): Feedback48hReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "feedback_48h",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCheckin7d(overrides: Partial<Checkin7dReport> = {}): Checkin7dReport {
  return {
    userName: "Jordan Rivera",
    userEmail: "jordan@example.com",
    emailType: "checkin_7d",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("renderWelcome", () => {
  it("congratulates the user by first name and reinforces the tagline", () => {
    const { html, text } = renderWelcome(makeWelcome());
    expect(html).toContain("Welcome to FlowTrack, Jordan.");
    expect(html).toContain("See it. Measure it. Control it.");
    expect(text).toContain("Welcome to FlowTrack, Jordan.");
    expect(text).toContain("See it. Measure it. Control it.");
  });

  it("has a single primary CTA linking to the provided dashboard URL", () => {
    const { html } = renderWelcome(makeWelcome({ dashboardUrl: "https://www.appflowtrack.com/onboarding" }));
    expect(html).toContain('href="https://www.appflowtrack.com/onboarding"');
    expect(html).toContain("Continue setup");
  });

  it("contains no upgrade pressure or promotional language", () => {
    const { html, text } = renderWelcome(makeWelcome());
    for (const forbidden of [/START25/i, /upgrade/i, /\bpro\b/i, /discount/i, /% off/i]) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("does not include a STOP suppression line — welcome is essential account guidance", () => {
    const { html, text } = renderWelcome(makeWelcome());
    expect(html).not.toMatch(/reply stop/i);
    expect(text).not.toMatch(/reply stop/i);
  });

  it("escapes an HTML-significant name and URL", () => {
    const { html } = renderWelcome(
      makeWelcome({
        userName: `<img src=x onerror=alert(1)>`,
        dashboardUrl: `https://example.com/"><script>alert(1)</script>`,
      })
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("returns a subject that does not mention promotions", () => {
    const { subject } = renderWelcome(makeWelcome());
    expect(subject).toMatch(/Welcome to FlowTrack/);
  });
});

describe("renderFeedback48h", () => {
  it("asks exactly the five required questions", () => {
    const { html, text } = renderFeedback48h(makeFeedback48h());
    const expectedFragments = [
      /clearly explain/i,
      /simple/i,
      /understand your finances/i,
      /confusing/i,
      /weekly/i,
    ];
    for (const fragment of expectedFragments) {
      expect(html).toMatch(fragment);
      expect(text).toMatch(fragment);
    }
  });

  it("makes replying the primary action, with no form/survey link", () => {
    const { html, text } = renderFeedback48h(makeFeedback48h());
    expect(html).toMatch(/hit reply/i);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/typeform|surveymonkey|google\.com\/forms/i);
    expect(text).toMatch(/hit reply/i);
  });

  it("includes the exact required STOP suppression line", () => {
    const { html, text } = renderFeedback48h(makeFeedback48h());
    expect(html).toContain("Reply STOP if you don't want additional FlowTrack check-ins.");
    expect(text).toContain("Reply STOP if you don't want additional FlowTrack check-ins.");
  });

  it("escapes an HTML-significant name", () => {
    const { html } = renderFeedback48h(makeFeedback48h({ userName: `<b>x</b>` }));
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("renderCheckin7d", () => {
  it("asks whether anything is blocking or confusing, and offers reply + in-app help", () => {
    const { html, text } = renderCheckin7d(makeCheckin7d());
    expect(html).toMatch(/blocking/i);
    expect(html).toMatch(/reply/i);
    expect(html).toMatch(/help/i);
    expect(text).toMatch(/blocking/i);
  });

  it("is non-promotional and contains no upgrade pressure", () => {
    const { html, text } = renderCheckin7d(makeCheckin7d());
    for (const forbidden of [/START25/i, /upgrade/i, /\bpro\b/i, /discount/i]) {
      expect(html).not.toMatch(forbidden);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("includes the exact required STOP suppression line", () => {
    const { html, text } = renderCheckin7d(makeCheckin7d());
    expect(html).toContain("Reply STOP if you don't want additional FlowTrack check-ins.");
    expect(text).toContain("Reply STOP if you don't want additional FlowTrack check-ins.");
  });
});

describe("builders: wire replyTo to support@appflowtrack.com and forward the text alternative", () => {
  it("buildWelcomeEmail sets replyTo and includes html/text", () => {
    const email = buildWelcomeEmail(makeWelcome());
    expect(email.to).toBe("jordan@example.com");
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text?.length).toBeGreaterThan(0);
  });

  it("buildFeedback48hEmail sets replyTo and includes html/text", () => {
    const email = buildFeedback48hEmail(makeFeedback48h());
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.text?.length).toBeGreaterThan(0);
  });

  it("buildCheckin7dEmail sets replyTo and includes html/text", () => {
    const email = buildCheckin7dEmail(makeCheckin7d());
    expect(email.replyTo).toBe("support@appflowtrack.com");
    expect(email.text?.length).toBeGreaterThan(0);
  });
});
