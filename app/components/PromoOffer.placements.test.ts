import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relPath: string) => readFileSync(join(__dirname, relPath), "utf-8");

describe("approved acquisition surfaces render the promotion", () => {
  it("landing page uses all three landing placements", () => {
    const source = read("../page.tsx");
    expect(source).toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
    expect(source).toContain("<PromoAnnouncementBar");
    expect(source).toContain("<PromoHeroBadge");
    expect(source).toContain("<PromoCallout");
  });

  it("landing page revalidates periodically so an expired campaign disappears without a redeploy", () => {
    const source = read("../page.tsx");
    expect(source).toMatch(/export const revalidate\s*=\s*\d+/);
  });

  it("dashboard Unlock Pro modal includes the promo callout", () => {
    const source = read("../dashboard/page.tsx");
    expect(source).toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
    expect(source).toContain("<PromoCallout");
  });

  it("the live /restore acquisition modal (mirrors dashboard) includes the promo callout", () => {
    const source = read("../restore/page.tsx");
    expect(source).toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
    expect(source).toContain("<PromoCallout");
  });
});

describe("promotion is withheld from non-acquisition / existing-subscriber surfaces", () => {
  it("existing subscriber settings/billing page has no promo import or code reference", () => {
    const source = read("../dashboard/settings/page.tsx");
    expect(source).not.toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
    expect(source).not.toContain("START25");
    expect(source).not.toContain("PROMOTION");
  });

  it("existing subscriber settings page still shows no specific dollar rate at all (unchanged from prior release)", () => {
    const source = read("../dashboard/settings/page.tsx");
    expect(source).not.toContain("$7.99");
    expect(source).not.toContain("$5.49");
  });

  it("the Stripe billing portal route has no promo reference", () => {
    const source = read("../api/stripe/portal/route.ts");
    expect(source).not.toContain("START25");
    expect(source).not.toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
  });

  it("login and signup screens have no promo reference", () => {
    for (const path of ["../login/page.tsx", "../signup/page.tsx"]) {
      const source = read(path);
      expect(source).not.toContain("START25");
      expect(source).not.toMatch(/from ["']@\/app\/components\/PromoOffer["']/);
    }
  });

  it("operational reminder emails have no promo reference", () => {
    const source = read("../../lib/daily-companion/email-templates.ts");
    expect(source).not.toContain("START25");
    expect(source).not.toContain("PROMOTION");
  });
});

describe("checkout behavior is untouched by this change", () => {
  it("checkout route still doesn't hardcode START25 or auto-apply any discount", () => {
    const source = read("../api/stripe/checkout/route.ts");
    expect(source).not.toContain("START25");
    expect(source).toMatch(/allow_promotion_codes:\s*true/);
    expect(source).not.toMatch(/\bdiscounts\s*:/);
    expect(source).not.toMatch(/\bpromotion_code\s*:/);
  });
});
