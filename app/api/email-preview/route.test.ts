import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("email-preview route: local-development-only", () => {
  it("returns 404 on NODE_ENV === 'production' as the first statement in GET", () => {
    const getBody = source.slice(source.indexOf("export async function GET"));
    const nodeEnvCheckIndex = getBody.indexOf('process.env.NODE_ENV === "production"');
    const status404Index = getBody.indexOf("status: 404");
    const searchParamsIndex = getBody.indexOf("new URL(req.url)");

    expect(nodeEnvCheckIndex).toBeGreaterThan(-1);
    expect(status404Index).toBeGreaterThan(-1);
    expect(nodeEnvCheckIndex).toBeLessThan(status404Index);
    expect(status404Index).toBeLessThan(searchParamsIndex);
  });

  it("documents why one NODE_ENV check covers both Vercel Preview and Production", () => {
    expect(source).toMatch(/NODE_ENV=production/);
    expect(source).toMatch(/Preview/);
    expect(source).toMatch(/Production/);
  });
});

describe("email-preview route: fixtures use obviously fictional data, not personal information", () => {
  it("contains no personal name or real-looking email address", () => {
    expect(source).not.toMatch(/Alberto/);
    expect(source).not.toMatch(/novalabsdigital\.com/);
    expect(source).not.toMatch(/demo@flowtrack\.com/);
  });

  it("uses a clearly fictional name and the reserved example.com domain", () => {
    expect(source).toContain("Jordan Rivera");
    expect(source).toContain("preview.user@example.com");
  });
});

describe("email-preview route: all existing preview types still work locally", () => {
  it("preserves every preview type switch case", () => {
    for (const type of [
      "congratulations",
      "weekly",
      "monthly",
      "bill_bank_account",
      "bill_credit_card",
      "bill_legacy",
    ]) {
      expect(source).toContain(`case "${type}":`);
    }
  });

  it("still supports both the html and json response formats", () => {
    expect(source).toContain('searchParams.get("format") === "json"');
    expect(source).toContain('headers: { "Content-Type": "text/html" }');
  });
});

describe("email-preview route: production templates untouched", () => {
  it("still imports the real render functions from lib/daily-companion, unmodified", () => {
    for (const fn of [
      "renderGoodMorning",
      "renderBillReminder",
      "renderCongratulations",
      "renderWeeklyProgress",
      "renderMonthlyProgress",
    ]) {
      expect(source).toContain(fn);
    }
  });
});
