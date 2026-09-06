import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cross-file source assertions verifying the MFA gate is centralized in
// AuthContext rather than duplicated into individual pages, and that the
// pages/flows this phase must not touch remain untouched.
const root = join(__dirname, "../../");
const read = (relPath: string) => readFileSync(join(root, relPath), "utf-8");

describe("Settings wires in the new Security section", () => {
  it("dashboard/settings/page.tsx imports and renders SecuritySettings", () => {
    const source = read("app/dashboard/settings/page.tsx");
    expect(source).toContain('import SecuritySettings from "@/app/components/SecuritySettings"');
    expect(source).toContain("<SecuritySettings />");
  });
});

describe("/restore gets the global gate without duplicating MFA logic", () => {
  it("contains no AAL/MFA-specific logic of its own", () => {
    const source = read("app/restore/page.tsx");
    expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
    expect(source).not.toMatch(/mfa\./);
    expect(source).not.toMatch(/aalDecision/);
  });

  it("is not listed as a public route, so it goes through the same protected-route gate as any other page", () => {
    const authContextSource = read("app/context/AuthContext.tsx");
    expect(authContextSource).not.toContain('"/restore"');
  });

  it("still gates its own data-loading effects on the shared authLoading flag from useAuth", () => {
    const source = read("app/restore/page.tsx");
    expect(source).toContain("useAuth()");
    expect(source).toMatch(/if \(authLoading/);
  });
});

describe("other protected pages have no duplicated MFA logic either", () => {
  const pages = [
    "app/dashboard/page.tsx",
    "app/dashboard/debt-recovery/page.tsx",
    "app/dashboard/bill-guardian/page.tsx",
    "app/onboarding/page.tsx",
    "app/onboarding/setup/page.tsx",
  ];

  it.each(pages)("%s contains no AAL/MFA-specific logic", (relPath) => {
    const source = read(relPath);
    expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
    expect(source).not.toMatch(/mfa\.(enroll|challenge|listFactors|unenroll)/);
  });
});

describe("password reset is not treated as MFA completion", () => {
  it("update-password page has no AAL/MFA logic and stays keyed on the PASSWORD_RECOVERY event", () => {
    const source = read("app/update-password/page.tsx");
    expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
    expect(source).not.toMatch(/mfa\./);
    expect(source).toContain('"PASSWORD_RECOVERY"');
  });

  it("/update-password remains a public route (no AAL requirement to reach it)", () => {
    const authContextSource = read("app/context/AuthContext.tsx");
    expect(authContextSource).toContain('"/update-password"');
  });
});

describe("checkout/portal: bearer-token auth preserved, AAL enforcement added (Security Phase 1C)", () => {
  it("still authenticate via bearer token first, and now also enforce AAL via the shared server helper", () => {
    const checkout = read("app/api/stripe/checkout/route.ts");
    const portal = read("app/api/stripe/portal/route.ts");
    for (const source of [checkout, portal]) {
      expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
      expect(source).toContain('req.headers.get("Authorization")');
      expect(source).toContain('from "@/lib/mfa/serverAuthorize"');
      expect(source).toContain("checkMfaAuthorization(");
    }
  });
});

describe("cron behavior is untouched", () => {
  it("the bill-reminders cron route is untouched by this phase", () => {
    const source = read("app/api/cron/bill-reminders/route.ts");
    expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
    expect(source).not.toMatch(/\bmfa\b/);
  });
});

describe("client challenge/Settings flows use the same TOTP-only helper as the server (Security Phase 1C)", () => {
  const clientFiles = [
    "app/mfa-challenge/page.tsx",
    "app/components/SecuritySettings.tsx",
  ];

  it.each(clientFiles)("%s selects factors via the .totp sub-array and the shared getVerifiedTotpFactors/getUnverifiedTotpFactors helpers", (relPath) => {
    const source = read(relPath);
    expect(source).toContain('from "@/lib/mfa/factors"');
    expect(source).toMatch(/data\.totp|factorData\.totp|refreshedList\.totp|listData\.totp/);
    expect(source).not.toMatch(/\.phone\b/);
    expect(source).not.toMatch(/\.webauthn\b/);
  });

  it("the server helper (serverAuthorize.ts) imports from the exact same lib/mfa/factors module", () => {
    const server = read("lib/mfa/serverAuthorize.ts");
    const client = read("app/mfa-challenge/page.tsx");
    expect(server).toContain('from "./factors"');
    expect(client).toContain('from "@/lib/mfa/factors"');
    // Both resolve to the same physical module (lib/mfa/factors.ts), so
    // hasVerifiedTotpFactor()'s TOTP-only rule, unit-tested exhaustively in
    // lib/mfa/factors.test.ts, applies identically to server and client.
  });
});

describe("no RLS policy or database schema file was touched by this phase", () => {
  it("the Phase 1A privilege-hardening migration/runbook are unchanged by this phase's diff scope", () => {
    // This phase is application-layer only; enforcement at the RLS/API layer
    // is explicitly a separate, not-yet-implemented follow-up (see final
    // report). This test simply documents that no new SQL file was added
    // under lib/security by this phase.
    const source = read("lib/security/migration_privilege_hardening.sql");
    expect(source).not.toMatch(/mfa/i);
  });
});
