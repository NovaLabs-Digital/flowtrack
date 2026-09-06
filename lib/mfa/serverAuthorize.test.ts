import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This module calls Supabase directly; there's no request-mocking harness in
// this repo (consistent with the rest of the codebase), so these are
// source-content assertions rather than invoked-handler tests. The pure
// decision logic itself (decideServerMfaAccess) is fully unit-tested in
// serverAal.test.ts.
const source = readFileSync(join(__dirname, "./serverAuthorize.ts"), "utf-8");

// The rationale comment in the source legitimately mentions the rejected API
// by name; only the executable code must never call it.
const executableSource = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("checkMfaAuthorization: does not use the nonexistent JWT-argument getAuthenticatorAssuranceLevel", () => {
  it("never calls getAuthenticatorAssuranceLevel in the executable code", () => {
    expect(executableSource).not.toMatch(/getAuthenticatorAssuranceLevel/);
  });

  it("documents why, citing the installed package source", () => {
    expect(source).toMatch(/does not exist in this form/);
    expect(source).toMatch(/zero parameters/);
    expect(source).toMatch(/GoTrueClient\.js/);
  });
});

describe("checkMfaAuthorization: uses verified, live data sources", () => {
  it("verifies the token via getClaims", () => {
    expect(source).toContain("supabaseAdmin.auth.getClaims(token)");
  });

  it("cross-checks the verified claim subject against the already-authenticated user id", () => {
    expect(source).toMatch(/claimsData\.claims\.sub !== userId/);
  });

  it("looks up enrollment live via the Admin API, not a cached/session-embedded factors list", () => {
    expect(source).toContain("supabaseAdmin.auth.admin.mfa.listFactors({");
    expect(source).toContain("userId,");
  });

  it("delegates the actual decision to the shared pure predicate", () => {
    expect(source).toContain("decideServerMfaAccess({ currentAal, hasVerifiedFactor })");
  });
});

describe("checkMfaAuthorization: TOTP-only enrollment (Security Phase 1C)", () => {
  it("reuses the canonical TOTP factor helper directly, with no type assertion needed to force compatibility", () => {
    expect(source).toContain("hasVerifiedTotpFactor(factorData.factors)");
    expect(executableSource).not.toMatch(/factorData\.factors\s+as\s+/);
  });

  it("does not import or use any broader 'any verified factor' helper", () => {
    expect(source).not.toMatch(/hasVerifiedFactor\(/); // only the local boolean variable is named this, never a call
    expect(source).not.toContain("hasAnyVerifiedFactor");
  });

  it("documents why no cast is needed (structural compatibility with the Admin API's Factor[] type)", () => {
    expect(source).toMatch(/structurally compatible/);
  });
});

describe("checkMfaAuthorization: fails closed on every error path", () => {
  it("fails closed if getClaims errors or is missing", () => {
    const block = source.slice(
      source.indexOf("const { data: claimsData"),
      source.indexOf("const currentAal")
    );
    expect(block).toMatch(/if \(claimsError \|\| !claimsData \|\| claimsData\.claims\.sub !== userId\) \{/);
    expect(block).toMatch(/return \{ authorized: false \};/);
  });

  it("fails closed if listFactors errors or is missing, rather than assuming not-enrolled", () => {
    const block = source.slice(
      source.indexOf("const { data: factorData"),
      source.indexOf("const hasVerifiedFactor")
    );
    expect(block).toMatch(/if \(factorError \|\| !factorData\) \{/);
    expect(block).toMatch(/return \{ authorized: false \};/);
  });
});

describe("checkMfaAuthorization: generic denial contract", () => {
  it("exports a single generic 403 status and body for reuse by every calling route", () => {
    expect(source).toMatch(/export const MFA_DENIAL_STATUS = 403;/);
    expect(source).toMatch(/export const MFA_DENIAL_BODY = \{ error: "Forbidden" \} as const;/);
  });
});

describe("checkMfaAuthorization: never logs sensitive data", () => {
  it("contains no console.log/error/warn calls", () => {
    expect(source).not.toMatch(/console\.(log|error|warn)/);
  });
});
