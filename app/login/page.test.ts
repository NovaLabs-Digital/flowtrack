import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-content assertions, following this repo's convention of not
// fabricating a rendered-component test where no component-test harness
// exists.
const source = readFileSync(join(__dirname, "./page.tsx"), "utf-8");

describe("login page: MFA is checked only after a successful sign-in", () => {
  it("never checks AAL/MFA before signInWithPassword succeeds", () => {
    const submitBody = source.slice(
      source.indexOf("async function handleSubmit"),
      source.indexOf("async function handleResetPassword")
    );
    const signInIndex = submitBody.indexOf("signInWithPassword(");
    const errorCheckIndex = submitBody.indexOf("if (error) {");
    const aalCheckIndex = submitBody.indexOf("getAuthenticatorAssuranceLevel()");

    expect(signInIndex).toBeGreaterThan(-1);
    expect(aalCheckIndex).toBeGreaterThan(-1);
    // The invalid-credential branch (and its early return) must be able to
    // exit before any MFA check ever runs.
    expect(signInIndex).toBeLessThan(errorCheckIndex);
    expect(errorCheckIndex).toBeLessThan(aalCheckIndex);
  });

  it("preserves the existing invalid-credential error handling", () => {
    expect(source).toMatch(/setErrorMessage\(error\.message \|\| "Login failed\."\)/);
  });
});

describe("login page: routes based on the shared AAL decision", () => {
  it("uses the shared pure decision function rather than re-deriving it locally", () => {
    expect(source).toMatch(/from ["']@\/lib\/mfa\/aal["']/);
    expect(source).toContain("decideAalAction");
  });

  it("sends an aal1-enrolled user to /mfa-challenge with a sanitized next param", () => {
    expect(source).toMatch(/decision === "challenge"/);
    expect(source).toMatch(/router\.push\(`\/mfa-challenge\?next=/);
  });

  it("sends everyone else straight to the sanitized intended destination", () => {
    expect(source).toContain("sanitizeNextPath(searchParams?.get(\"next\"))");
    expect(source).toMatch(/router\.push\(intendedNext\)/);
  });
});

describe("login page: no hard page redirect where router.push suffices", () => {
  it("does not use window.location for the post-login navigation", () => {
    const submitBody = source.slice(
      source.indexOf("async function handleSubmit"),
      source.indexOf("async function handleResetPassword")
    );
    expect(submitBody).not.toMatch(/window\.location/);
  });
});

describe("login page: useSearchParams is wrapped in Suspense", () => {
  it("the exported default component only renders a Suspense boundary", () => {
    const defaultExport = source.slice(
      source.indexOf("export default function LoginPage"),
      source.indexOf("function LoginForm")
    );
    expect(defaultExport).toContain("<Suspense");
  });
});
