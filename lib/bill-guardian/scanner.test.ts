import { describe, expect, it } from "vitest";
import { scanBills } from "./scanner";
import type { Debt } from "../debt-recovery/types";

const today = { year: 2026, month: 7, day: 11 };

function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "debt-1",
    user_id: "user-1",
    name: "Chase Visa",
    type: "credit_card",
    balance: 4200,
    apr: 22.99,
    minimum_payment: 145,
    due_day: 11,
    payment_plan: "minimum",
    custom_payment: null,
    status: "open",
    notes: null,
    last_payment_date: null,
    reminder_enabled: true,
    reminder_method: "email",
    reminder_offset: 1,
    last_reminder_sent_at: null,
    payment_source_type: null,
    payment_source_name: null,
    payment_source_last4: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scanBills payment source pass-through", () => {
  it("carries a bank account payment source onto the reminder", () => {
    const debt = makeDebt({
      payment_source_type: "bank_account",
      payment_source_name: "Chase Checking",
      payment_source_last4: "1234",
    });
    const report = scanBills([debt], null, today);
    expect(report.dueToday[0].paymentSourceName).toBe("Chase Checking");
    expect(report.dueToday[0].paymentSourceLast4).toBe("1234");
  });

  it("carries a credit card payment source onto the reminder", () => {
    const debt = makeDebt({
      payment_source_type: "credit_card",
      payment_source_name: "Capital One Visa",
      payment_source_last4: "5678",
    });
    const report = scanBills([debt], null, today);
    expect(report.dueToday[0].paymentSourceName).toBe("Capital One Visa");
    expect(report.dueToday[0].paymentSourceLast4).toBe("5678");
  });

  it("defaults to null for a legacy debt row with no payment source columns", () => {
    const debt = makeDebt();
    delete (debt as Record<string, unknown>).payment_source_name;
    delete (debt as Record<string, unknown>).payment_source_last4;
    delete (debt as Record<string, unknown>).payment_source_type;

    const report = scanBills([debt], null, today);
    expect(report.dueToday[0].paymentSourceName).toBeNull();
    expect(report.dueToday[0].paymentSourceLast4).toBeNull();
  });

  it("does not change reminder bucketing or dueInDays based on payment source presence", () => {
    const withSource = makeDebt({
      payment_source_name: "Chase Checking",
      payment_source_last4: "1234",
    });
    const withoutSource = makeDebt({ id: "debt-2" });

    const report = scanBills([withSource, withoutSource], null, today);
    expect(report.dueToday).toHaveLength(2);
    expect(report.dueToday[0].dueInDays).toBe(0);
    expect(report.dueToday[1].dueInDays).toBe(0);
  });

  it("leaves status and debtId (what drives the 'I've Paid This' action) unaffected by payment source data", () => {
    const withSource = makeDebt({
      id: "debt-with-source",
      payment_source_name: "Regions",
      payment_source_last4: "3397",
    });
    const withoutSource = makeDebt({ id: "debt-without-source" });

    const report = scanBills([withSource, withoutSource], null, today);
    const [a, b] = report.dueToday;

    expect(a.debtId).toBe("debt-with-source");
    expect(b.debtId).toBe("debt-without-source");
    expect(a.status).toBe(b.status);
    expect(a.status).toBe("due_today");
    expect(a.lastPaymentDate).toBe(b.lastPaymentDate);
  });
});
