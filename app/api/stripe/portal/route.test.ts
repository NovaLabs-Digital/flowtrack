import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This route talks to Stripe and Supabase directly; there's no request-mocking
// harness in this repo, so these are source-content assertions rather than
// invoked-handler tests.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("existing behavior preserved", () => {
  it("still requires a bearer auth token and validates the Supabase session", () => {
    expect(source).toContain('req.headers.get("Authorization")');
    expect(source).toContain("supabaseAdmin.auth.getUser(token)");
    expect(source).toMatch(/status:\s*401/);
  });

  it("the 401 (invalid/missing bearer) check happens before the MFA check, and is unmodified", () => {
    const unauthorizedIndex = source.indexOf('{ error: "Unauthorized" }, { status: 401 }');
    const mfaCheckIndex = source.indexOf("checkMfaAuthorization(");
    expect(unauthorizedIndex).toBeGreaterThan(-1);
    expect(mfaCheckIndex).toBeGreaterThan(-1);
    expect(unauthorizedIndex).toBeLessThan(mfaCheckIndex);
  });

  it("still looks up stripe_customer_id and 404s when the customer is missing", () => {
    expect(source).toContain('.select("stripe_customer_id")');
    expect(source).toMatch(/status:\s*404/);
  });

  it("still creates a billing portal session returning to /dashboard", () => {
    expect(source).toContain("stripe.billingPortal.sessions.create(");
    expect(source).toContain("/dashboard`");
  });
});

describe("MFA/AAL enforcement (Security Phase 1C)", () => {
  it("imports and calls the shared server-side MFA authorization helper", () => {
    expect(source).toContain('from "@/lib/mfa/serverAuthorize"');
    expect(source).toContain("checkMfaAuthorization(supabaseAdmin, token, user.id)");
  });

  it("denies with the shared generic MFA denial body/status, not a bespoke message", () => {
    expect(source).toMatch(/if \(!authorized\) \{/);
    expect(source).toContain("NextResponse.json(MFA_DENIAL_BODY, { status: MFA_DENIAL_STATUS })");
  });

  it("the MFA check runs before the profile/Stripe customer lookup", () => {
    const mfaCheckIndex = source.indexOf("checkMfaAuthorization(");
    const profileLookupIndex = source.indexOf('.select("stripe_customer_id")');
    expect(mfaCheckIndex).toBeLessThan(profileLookupIndex);
  });
});

describe("never logs sensitive data", () => {
  it("the only console.error is the pre-existing generic Stripe portal error, not tokens/factors", () => {
    const consoleCalls = source.match(/console\.(log|error|warn)\([^)]*/g) ?? [];
    for (const call of consoleCalls) {
      expect(call).not.toMatch(/token|factor|aal|code/i);
    }
  });
});
