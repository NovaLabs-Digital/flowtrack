import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Same convention as app/api/stripe/checkout/route.test.ts: no request-mocking
// harness in this repo, so these assertions verify the deployed behavior from
// source rather than by invoking the handler.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("test-email route: unavailable in every deployed environment", () => {
  it("returns 404 on NODE_ENV === 'production' as the very first check in POST", () => {
    const postBody = source.slice(source.indexOf("export async function POST"));
    const nodeEnvCheckIndex = postBody.indexOf('process.env.NODE_ENV === "production"');
    const status404Index = postBody.indexOf("status: 404");
    const opinInCheckIndex = postBody.indexOf("ENABLE_TEST_EMAIL");
    const recipientCheckIndex = postBody.indexOf("TEST_EMAIL_RECIPIENT");
    const buildReportCallIndex = postBody.indexOf("buildTestReport(recipient)");

    expect(nodeEnvCheckIndex).toBeGreaterThan(-1);
    expect(status404Index).toBeGreaterThan(-1);
    // The production check (and its 404 response) must precede every other
    // guard and every call that could build or send an email.
    expect(nodeEnvCheckIndex).toBeLessThan(status404Index);
    expect(status404Index).toBeLessThan(opinInCheckIndex);
    expect(status404Index).toBeLessThan(recipientCheckIndex);
    expect(status404Index).toBeLessThan(buildReportCallIndex);
  });

  it("documents why one NODE_ENV check covers both Vercel Preview and Production", () => {
    // Documented in-source reasoning, asserted so the rationale can't silently drift.
    expect(source).toMatch(/next build/);
    expect(source).toMatch(/NODE_ENV=production/);
    expect(source).toMatch(/Preview/);
  });
});

describe("test-email route: sendEmail is never reachable on the production path", () => {
  it("the 404 return happens before buildGoodMorningEmail/sendEmail are ever called", () => {
    const postBody = source.slice(source.indexOf("export async function POST"));
    const status404Index = postBody.indexOf("status: 404");
    const buildEmailCallIndex = postBody.indexOf("buildGoodMorningEmail(");
    const sendEmailCallIndex = postBody.indexOf("sendEmail(email)");

    expect(status404Index).toBeLessThan(buildEmailCallIndex);
    expect(status404Index).toBeLessThan(sendEmailCallIndex);
  });
});

describe("test-email route: local sending requires explicit opt-in AND a recipient", () => {
  it("fails closed (no send) if ENABLE_TEST_EMAIL is not exactly 'true'", () => {
    expect(source).toMatch(/process\.env\.ENABLE_TEST_EMAIL !== "true"/);
    const optInBlock = source.slice(
      source.indexOf('process.env.ENABLE_TEST_EMAIL !== "true"'),
      source.indexOf("const recipient")
    );
    expect(optInBlock).toMatch(/return NextResponse\.json/);
  });

  it("fails closed (no send) if TEST_EMAIL_RECIPIENT is unset", () => {
    expect(source).toContain("process.env.TEST_EMAIL_RECIPIENT");
    const recipientBlock = source.slice(
      source.indexOf("const recipient = process.env.TEST_EMAIL_RECIPIENT"),
      source.indexOf("try {")
    );
    expect(recipientBlock).toMatch(/if \(!recipient\)/);
    expect(recipientBlock).toMatch(/return NextResponse\.json/);
  });

  it("only builds/sends the email after both the opt-in and recipient checks pass", () => {
    const optInIndex = source.indexOf("ENABLE_TEST_EMAIL");
    const recipientCheckIndex = source.indexOf("if (!recipient)");
    const sendIndex = source.indexOf("buildGoodMorningEmail(buildTestReport(recipient))");
    expect(optInIndex).toBeLessThan(sendIndex);
    expect(recipientCheckIndex).toBeLessThan(sendIndex);
  });
});

describe("test-email route: no personal recipient hardcoded or returned", () => {
  it("contains no hardcoded personal name or email address", () => {
    expect(source).not.toMatch(/Alberto/);
    expect(source).not.toMatch(/novalabsdigital\.com/);
    expect(source).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });

  it("the recipient comes only from the TEST_EMAIL_RECIPIENT env var, not a literal", () => {
    expect(source).toMatch(/buildTestReport\(recipient\)/);
  });

  it("never echoes the recipient address back in any response", () => {
    expect(source).not.toMatch(/sentTo/);
    expect(source).not.toMatch(/recipient\s*[,}]/); // recipient is used to build the report, never placed in a response object
    const successResponse = source.slice(source.indexOf("success: true"), source.indexOf("success: true") + 60);
    expect(successResponse).not.toContain("recipient");
    expect(successResponse).not.toContain("email.to");
  });
});

describe("test-email route: does not touch sendEmail(), templates, or cron behavior", () => {
  it("still imports the real buildGoodMorningEmail/sendEmail from lib/daily-companion, unmodified", () => {
    expect(source).toContain('from "@/lib/daily-companion"');
    expect(source).toContain("buildGoodMorningEmail");
    expect(source).toContain("sendEmail");
  });
});

describe("cron reminder delivery is unaffected by these changes", () => {
  it("the cron route still builds and sends real reminder emails the same way", () => {
    const cronSource = readFileSync(
      join(__dirname, "../cron/bill-reminders/route.ts"),
      "utf-8"
    );
    expect(cronSource).toContain("buildDailyReport(");
    expect(cronSource).toContain("buildGoodMorningEmail(dailyReport)");
    expect(cronSource).toContain("sendEmail(email)");
    // The cron route's own auth model (CRON_SECRET) is untouched by this change.
    expect(cronSource).toContain("CRON_SECRET");
  });
});
