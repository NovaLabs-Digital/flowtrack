import { describe, expect, it } from "vitest";
import { renderBillReminder, renderGoodMorning } from "./email-templates";
import type { DailyReport, BillDue } from "./types";

function makeBill(overrides: Partial<BillDue> = {}): BillDue {
  return {
    name: "Chase Visa",
    dueLabel: "Due Today",
    minimumPayment: 145,
    recommendedPayment: 145,
    freedomDaysGained: 0,
    balance: 4200,
    paymentSourceName: null,
    paymentSourceLast4: null,
    ...overrides,
  };
}

function makeReport(bills: BillDue[]): DailyReport {
  return {
    userName: "Alberto",
    userEmail: "alberto@example.com",
    emailType: "good_morning",
    greeting: "Good morning, Alberto.",
    bills,
    freedomDate: "January 1, 2030",
    freedomDaysGained: 0,
    debtRemaining: 0,
    progressPercent: 0,
    encouragement: "Keep going.",
    generatedAt: new Date().toISOString(),
  };
}

describe("payment source rendering in the bill reminder email", () => {
  it("shows the name and last four digits when both exist", () => {
    const bill = makeBill({ paymentSourceName: "Chase Checking", paymentSourceLast4: "1234" });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).toContain("Payment source: Chase Checking •••• 1234");
  });

  it("shows only the name when last4 is absent", () => {
    const bill = makeBill({ paymentSourceName: "Chase Checking", paymentSourceLast4: null });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).toContain("Payment source: Chase Checking");
    expect(html).not.toContain("••••");
  });

  it("shows a credit card source with name and last four digits", () => {
    const bill = makeBill({
      name: "Capital One Visa",
      paymentSourceName: "Capital One Visa",
      paymentSourceLast4: "5678",
    });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).toContain("Payment source: Capital One Visa •••• 5678");
  });

  it("omits the line entirely when no payment source info exists (legacy bill)", () => {
    const bill = makeBill({ paymentSourceName: null, paymentSourceLast4: null });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).not.toContain("Payment source");
    expect(html).not.toContain("undefined");
  });

  it("omits the line for a legacy record where the fields are simply missing", () => {
    const bill = makeBill();
    delete (bill as Record<string, unknown>).paymentSourceName;
    delete (bill as Record<string, unknown>).paymentSourceLast4;
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).not.toContain("Payment source");
    expect(html).not.toContain("undefined");
  });

  it("escapes HTML-significant characters in the payment source name", () => {
    const bill = makeBill({
      paymentSourceName: `<img src=x onerror=alert(1)> & "Chase" 'Checking'`,
      paymentSourceLast4: "1234",
    });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;Chase&quot;");
    expect(html).toContain("&#39;Checking&#39;");
  });

  it("never renders a last4 value that is not exactly four digits, even if stored incorrectly", () => {
    const bill = makeBill({
      paymentSourceName: "Chase Checking",
      paymentSourceLast4: "12345678", // simulates a corrupted/legacy row
    });
    const { html } = renderBillReminder(makeReport([bill]));
    expect(html).not.toContain("12345678");
    expect(html).toContain("Payment source: Chase Checking");
  });

  it("renders per-bill payment source lines in the multi-bill good morning email", () => {
    const bills = [
      makeBill({ name: "Chase Visa", paymentSourceName: "Chase Checking", paymentSourceLast4: "1234" }),
      makeBill({ name: "Rent", paymentSourceName: null, paymentSourceLast4: null }),
    ];
    const { html } = renderGoodMorning(makeReport(bills));
    expect(html).toContain("Payment source: Chase Checking •••• 1234");
    expect(html.match(/Payment source:/g)?.length).toBe(1);
  });
});

describe("compact email wrapper layout", () => {
  it("keeps the outer page background white/transparent instead of full-bleed dark blue", () => {
    const { html } = renderBillReminder(makeReport([makeBill()]));
    expect(html).toContain('style="margin:0;padding:0;background:#ffffff;');
  });

  it("wraps the dark-blue background in a width-constrained, centered table instead of stretching it 100%", () => {
    const { html } = renderBillReminder(makeReport([makeBill()]));
    expect(html).toContain("max-width:592px;background:#0f172a;border-radius:20px;");
    expect(html).toContain('align="center"');
  });

  it("keeps the card only slightly narrower than its dark-blue wrapper (592px vs 560px)", () => {
    const { html } = renderBillReminder(makeReport([makeBill()]));
    expect(html).toContain("max-width:560px;background:#1e293b;");
  });

  it("no longer emits a 100%-width dark-blue table with page padding baked into it", () => {
    const { html } = renderBillReminder(makeReport([makeBill()]));
    expect(html).not.toContain('style="background:#0f172a;padding:32px 16px;"');
  });
});
