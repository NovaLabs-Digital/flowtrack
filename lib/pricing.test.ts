import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRICING } from "./pricing";

const read = (relPath: string) => readFileSync(join(__dirname, relPath), "utf-8");

describe("PRICING constant (single source of truth for acquisition pricing)", () => {
  it("has the new $7.99 monthly acquisition price", () => {
    expect(PRICING.monthly.label).toBe("$7.99");
  });

  it("leaves the annual price untouched", () => {
    expect(PRICING.yearly.label).toBe("$54.99");
  });
});

describe("acquisition screens display $7.99 via the central PRICING constant", () => {
  const acquisitionScreens: Array<{ name: string; path: string }> = [
    { name: "landing page pricing card", path: "../app/page.tsx" },
    { name: "dashboard Unlock Pro modal", path: "../app/dashboard/page.tsx" },
    { name: "restore snapshot (mirrors dashboard upgrade modal)", path: "../app/restore/page.tsx" },
  ];

  for (const screen of acquisitionScreens) {
    it(`${screen.name} imports PRICING instead of a hardcoded literal`, () => {
      const source = read(screen.path);
      expect(source).toMatch(/from ["']@\/lib\/pricing["']/);
      expect(source).toContain("PRICING.monthly.label");
    });

    it(`${screen.name} no longer advertises the old $5.49 price`, () => {
      const source = read(screen.path);
      expect(source).not.toContain("$5.49");
    });
  }
});

describe("grandfathered subscriber safety: settings/billing page never claims a specific new rate", () => {
  const settingsSource = read("../app/dashboard/settings/page.tsx");

  it("does not import or reference the acquisition PRICING constant at all", () => {
    expect(settingsSource).not.toMatch(/from ["']@\/lib\/pricing["']/);
    expect(settingsSource).not.toContain("PRICING");
  });

  it("does not display either the new $7.99 or the old $5.49 as a claimed current rate", () => {
    expect(settingsSource).not.toContain("$7.99");
    expect(settingsSource).not.toContain("$5.49");
  });

  it("still directs existing subscribers to the Stripe-hosted Billing Portal for their real rate", () => {
    expect(settingsSource).toContain("Open Billing Portal");
    expect(settingsSource).toContain("handleManageBilling");
  });

  it("dashboard's Unlock Pro / price modal is only reachable by non-Pro users (isPro gates it)", () => {
    const dashboardSource = read("../app/dashboard/page.tsx");
    // The modal that shows PRICING.monthly.label is opened via requirePro()/openUpgrade(),
    // which are only invoked from the non-Pro (isPro === false) branches of the file.
    expect(dashboardSource).toContain("function requirePro(isPro: boolean, onBlocked: () => void) {");
    expect(dashboardSource).toContain("if (isPro) return true;");
  });
});
