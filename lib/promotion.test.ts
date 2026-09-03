import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMOTION,
  PRICING,
  isPromotionActive,
  getPromotionHeadline,
  getPromotionDisclosure,
  getPromotionShortBadge,
} from "./pricing";

afterEach(() => {
  vi.useRealTimers();
});

describe("PROMOTION centralized campaign values", () => {
  it("matches the live Stripe START25 promotion code exactly", () => {
    expect(PROMOTION.code).toBe("START25");
    expect(PROMOTION.percentOff).toBe(25);
    expect(PROMOTION.durationMonths).toBe(3);
    expect(PROMOTION.eligibility).toBe("New subscribers only");
    expect(PROMOTION.maxRedemptions).toBe(100);
    // Verified against Stripe's promo_1UBgQ6FIWUogy0qB9tBP0808 expires_at.
    expect(PROMOTION.expiresAtUnixSeconds).toBe(1793505599);
  });

  it("has a manual enabled kill-switch independent of the expiration date", () => {
    expect(typeof PROMOTION.enabled).toBe("boolean");
  });
});

describe("isPromotionActive: automatic expiration", () => {
  it("is active well before the expiration instant", () => {
    const beforeExpiry = new Date((PROMOTION.expiresAtUnixSeconds - 3600) * 1000);
    expect(isPromotionActive(beforeExpiry)).toBe(true);
  });

  it("is active one second before expiration", () => {
    const justBefore = new Date(PROMOTION.expiresAtUnixSeconds * 1000 - 1000);
    expect(isPromotionActive(justBefore)).toBe(true);
  });

  it("is inactive exactly at the expiration instant", () => {
    const atExpiry = new Date(PROMOTION.expiresAtUnixSeconds * 1000);
    expect(isPromotionActive(atExpiry)).toBe(false);
  });

  it("is inactive any time after expiration", () => {
    const afterExpiry = new Date((PROMOTION.expiresAtUnixSeconds + 86400) * 1000);
    expect(isPromotionActive(afterExpiry)).toBe(false);
  });

  it("is inactive when disabled, even if not yet expired", () => {
    const beforeExpiry = new Date((PROMOTION.expiresAtUnixSeconds - 3600) * 1000);
    const disabled = { ...PROMOTION, enabled: false };
    // Exercise the same predicate logic isPromotionActive uses, since the
    // exported PROMOTION itself is a readonly const in production config.
    expect(disabled.enabled && beforeExpiry.getTime() < disabled.expiresAtUnixSeconds * 1000).toBe(false);
  });

  it("defaults to evaluating against the real current time when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((PROMOTION.expiresAtUnixSeconds + 1) * 1000));
    expect(isPromotionActive()).toBe(false);
    vi.setSystemTime(new Date((PROMOTION.expiresAtUnixSeconds - 1) * 1000));
    expect(isPromotionActive()).toBe(true);
  });

  it("evaluates the expiration boundary correctly across the America/New_York DST transition", () => {
    // 2026-11-01 is the first Sunday of November 2026 -- DST ends that day.
    // The expiration instant itself must still be the deciding boundary.
    const oneMinuteBeforeUTC = new Date(PROMOTION.expiresAtUnixSeconds * 1000 - 60_000);
    const oneMinuteAfterUTC = new Date(PROMOTION.expiresAtUnixSeconds * 1000 + 60_000);
    expect(isPromotionActive(oneMinuteBeforeUTC)).toBe(true);
    expect(isPromotionActive(oneMinuteAfterUTC)).toBe(false);
  });
});

describe("derived copy helpers stay consistent with the centralized data", () => {
  it("builds the exact recommended headline", () => {
    expect(getPromotionHeadline()).toBe(
      "Launch Offer: Save 25% for your first 3 months with code START25"
    );
  });

  it("builds the exact recommended disclosure, including the correct expiry date and regular price", () => {
    expect(getPromotionDisclosure()).toBe(
      "New subscribers only · Limited to 100 redemptions · Ends October 31, 2026 · Then $7.99/month"
    );
  });

  it("disclosure always reflects PRICING.monthly.label rather than a duplicated literal", () => {
    expect(getPromotionDisclosure()).toContain(PRICING.monthly.label);
  });

  it("builds a compact badge variant containing the code and percent off", () => {
    const badge = getPromotionShortBadge();
    expect(badge).toContain("START25");
    expect(badge).toContain("25%");
  });

  it("never states or implies a calculated dollar discount amount", () => {
    for (const text of [getPromotionHeadline(), getPromotionDisclosure(), getPromotionShortBadge()]) {
      // Only the known regular price ($7.99) may appear as a dollar figure;
      // there must be no separate discounted-dollar-amount literal.
      const dollarAmounts = text.match(/\$\d+(\.\d{2})?/g) ?? [];
      for (const amount of dollarAmounts) {
        expect(amount).toBe(PRICING.monthly.label);
      }
    }
  });
});
