import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This route talks to Stripe and Supabase directly; there's no request-mocking
// harness in this repo (consistent with the rest of the API routes), so these
// assertions verify the deployed request shape from source rather than by
// invoking the handler.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("checkout price selection", () => {
  it("selects the price via STRIPE_PRICE_MONTHLY_LIVE / STRIPE_PRICE_MONTHLY_TEST, not a hardcoded price ID", () => {
    expect(source).toContain("process.env.STRIPE_PRICE_MONTHLY_LIVE");
    expect(source).toContain("process.env.STRIPE_PRICE_MONTHLY_TEST");
    expect(source).not.toMatch(/price_1[A-Za-z0-9]{10,}/);
  });
});

describe("promotion code support", () => {
  it("passes allow_promotion_codes: true to the checkout session", () => {
    expect(source).toMatch(/allow_promotion_codes:\s*true/);
  });

  it("does not hardcode the START25 code, its coupon ID, or its promotion-code ID anywhere", () => {
    expect(source).not.toContain("START25");
    expect(source).not.toContain("1vFLLLp0");
    expect(source).not.toContain("promo_1UBgQ6FIWUogy0qB9tBP0808");
  });

  it("does not auto-apply any discount/promotion via the discounts or promotion_code params", () => {
    expect(source).not.toMatch(/\bdiscounts\s*:/);
    expect(source).not.toMatch(/\bpromotion_code\s*:/);
  });
});

describe("existing behavior preserved", () => {
  it("still requires a bearer auth token and validates the Supabase session", () => {
    expect(source).toContain('req.headers.get("Authorization")');
    expect(source).toContain("supabaseAdmin.auth.getUser(token)");
    expect(source).toMatch(/status:\s*401/);
  });

  it("still binds to the existing Stripe customer when one exists, else uses customer_email", () => {
    expect(source).toContain("stripeCustomerId");
    expect(source).toContain("customer_email: email");
  });

  it("still sets success_url, cancel_url, metadata, client_reference_id, and subscription_data metadata", () => {
    expect(source).toContain("success_url:");
    expect(source).toContain("cancel_url:");
    expect(source).toContain("metadata: { userId, email }");
    expect(source).toContain("client_reference_id: userId");
    expect(source).toContain("subscription_data:");
  });

  it("still creates a subscription-mode session with a single line item", () => {
    expect(source).toContain('mode: "subscription"');
    expect(source).toContain("line_items: [{ price: priceId, quantity: 1 }]");
  });
});
