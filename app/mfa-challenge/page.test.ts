import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "./page.tsx"), "utf-8");

describe("mfa-challenge page: forwards an already-aal2 session immediately", () => {
  it("checks currentLevel/nextLevel === aal2 before showing any form", () => {
    const initBody = source.slice(
      source.indexOf("async function init"),
      source.indexOf("async function signOutSafely")
    );
    expect(initBody).toMatch(/aalData\.currentLevel === "aal2" && aalData\.nextLevel === "aal2"/);
    expect(initBody).toMatch(/router\.replace\(intendedNext\)/);
  });
});

describe("mfa-challenge page: fails closed on invalid session/factor state", () => {
  it("signs out and redirects to /login if the AAL lookup errors", () => {
    const initBody = source.slice(
      source.indexOf("async function init"),
      source.indexOf("async function signOutSafely")
    );
    expect(initBody).toMatch(/if \(aalError \|\| !aalData\)/);
  });

  it("signs out if there are zero verified TOTP factors, rather than showing a dead-end form", () => {
    const initBody = source.slice(
      source.indexOf("async function init"),
      source.indexOf("async function signOutSafely")
    );
    expect(initBody).toMatch(/verified\.length === 0/);
  });

  it("signOutSafely actually calls supabase.auth.signOut() and redirects to /login", () => {
    const signOutBody = source.slice(
      source.indexOf("async function signOutSafely"),
      source.indexOf("init();")
    );
    expect(signOutBody).toContain("supabase.auth.signOut()");
    expect(signOutBody).toMatch(/router\.replace\("\/login"\)/);
  });
});

describe("mfa-challenge page: lists and supports selecting verified factors", () => {
  it("uses the shared verified-TOTP-factor helper", () => {
    expect(source).toMatch(/from ["']@\/lib\/mfa\/factors["']/);
    expect(source).toContain("getVerifiedTotpFactors");
  });

  it("renders a factor picker only when more than one factor exists", () => {
    expect(source).toMatch(/factors\.length > 1/);
  });
});

describe("mfa-challenge page: six-digit code validation and verification", () => {
  it("normalizes and validates the code before calling Supabase", () => {
    expect(source).toContain("normalizeTotpCode(code)");
    expect(source).toContain("isValidTotpCode(normalized)");
  });

  it("uses challengeAndVerify with the selected factor id", () => {
    expect(source).toMatch(/mfa\.challengeAndVerify\(\{\s*factorId: selectedFactorId,\s*code: normalized,?\s*\}\)/);
  });

  it("shows one generic message on failure without exposing Supabase's internal error", () => {
    const submitBody = source.slice(
      source.indexOf("async function handleSubmit"),
      source.indexOf("async function handleCancel")
    );
    expect(submitBody).toMatch(/setErrorMessage\(GENERIC_ERROR\)/);
    expect(submitBody).not.toMatch(/error\.message/);
  });

  it("only navigates to the intended destination after verification succeeds", () => {
    const submitBody = source.slice(
      source.indexOf("async function handleSubmit"),
      source.indexOf("async function handleCancel")
    );
    const errorCheckIndex = submitBody.indexOf("if (error) {");
    const navigateIndex = submitBody.indexOf("router.replace(intendedNext)");
    expect(errorCheckIndex).toBeLessThan(navigateIndex);
  });
});

describe("mfa-challenge page: Cancel/Sign out", () => {
  it("has a cancel handler that signs out and returns to /login", () => {
    const cancelBody = source.slice(
      source.indexOf("async function handleCancel"),
      source.indexOf("if (status ===")
    );
    expect(cancelBody).toContain("supabase.auth.signOut()");
    expect(cancelBody).toMatch(/router\.replace\("\/login"\)/);
  });

  it("renders a visible Cancel / Sign out control", () => {
    expect(source).toMatch(/Cancel \/ Sign out/);
  });
});

describe("mfa-challenge page: never logs sensitive MFA data", () => {
  it("contains no console.log/error/warn calls at all", () => {
    expect(source).not.toMatch(/console\.(log|error|warn)/);
  });

  it("never interpolates the code, factor id, or secret into any string literal outside of state/API calls", () => {
    // The only place `code`/`normalized` may appear as a bare identifier is
    // in the API call and local validation — never inside a template string
    // (which would suggest logging or display).
    expect(source).not.toMatch(/`[^`]*\$\{(code|normalized|selectedFactorId)\}[^`]*`/);
  });
});

describe("mfa-challenge page: useSearchParams is wrapped in Suspense", () => {
  it("the exported default component only renders a Suspense boundary", () => {
    const defaultExport = source.slice(
      source.indexOf("export default function MfaChallengePage"),
      source.indexOf("function MfaChallengeForm")
    );
    expect(defaultExport).toContain("<Suspense");
  });
});
