export const PRICING = {
  monthly: {
    label: "$7.99",
    period: "per month",
  },
  yearly: {
    label: "$54.99",
    period: "per year",
  },
} as const;

// Single source of truth for the START25 launch campaign. Mirrors the live
// Stripe promotion code (promo_1UBgQ6FIWUogy0qB9tBP0808) — this is display
// metadata only; entering the code still happens in Stripe Checkout's own
// "Add code" control, never automatically.
export const PROMOTION = {
  enabled: true,
  code: "START25",
  percentOff: 25,
  durationMonths: 3,
  eligibility: "New subscribers only",
  maxRedemptions: 100,
  // October 31, 2026, 11:59:59 PM America/New_York — matches the live
  // Stripe promotion code's expires_at exactly.
  expiresAtUnixSeconds: 1793505599,
} as const;

// True only while the campaign is both manually enabled AND not yet past
// its expiration instant. Callers must re-check this on every render (no
// caching) so an expired campaign disappears on its own — a statically
// generated page picks this up on its next revalidation, a client-rendered
// page picks it up on the visitor's next page load. No redeploy required.
export function isPromotionActive(now: Date = new Date()): boolean {
  return PROMOTION.enabled && now.getTime() < PROMOTION.expiresAtUnixSeconds * 1000;
}

function formatPromotionExpiry(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(PROMOTION.expiresAtUnixSeconds * 1000));
}

// "Launch Offer: Save 25% for your first 3 months with code START25"
export function getPromotionHeadline(): string {
  return `Launch Offer: Save ${PROMOTION.percentOff}% for your first ${PROMOTION.durationMonths} months with code ${PROMOTION.code}`;
}

// "New subscribers only · Limited to 100 redemptions · Ends October 31, 2026 · Then $7.99/month"
export function getPromotionDisclosure(): string {
  return `${PROMOTION.eligibility} · Limited to ${PROMOTION.maxRedemptions} redemptions · Ends ${formatPromotionExpiry()} · Then ${PRICING.monthly.label}/month`;
}

// Compact variant for tight spaces (hero mention): "START25: 25% off your first 3 months"
export function getPromotionShortBadge(): string {
  return `${PROMOTION.code}: ${PROMOTION.percentOff}% off your first ${PROMOTION.durationMonths} months`;
}
