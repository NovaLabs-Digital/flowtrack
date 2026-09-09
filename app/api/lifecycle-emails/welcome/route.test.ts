import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// No request-mocking harness in this repo (consistent with every other API
// route — see app/api/stripe/checkout/route.test.ts), so these are
// source-content assertions verifying the deployed request shape.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("welcome endpoint: bearer token verified server-side, never a client-supplied recipient", () => {
  it("requires an Authorization bearer token and verifies it via supabaseAdmin.auth.getUser", () => {
    expect(source).toContain('req.headers.get("Authorization")');
    expect(source).toContain("supabaseAdmin.auth.getUser(token)");
    expect(source).toMatch(/status:\s*401/);
  });

  it("never reads a recipient/email/userId from the request body or query string", () => {
    expect(source).not.toMatch(/req\.json\(\)/);
    expect(source).not.toMatch(/searchParams\.get\("email"\)/);
    expect(source).not.toMatch(/searchParams\.get\("userId"\)/);
  });

  it("derives the eligible user from the verified auth result, not any other source", () => {
    expect(source).toContain("toEligibleUser(data.user)");
  });
});

describe("welcome endpoint: applies the rollout cutoff and the shared lifecycle service", () => {
  it("parses SIGNUP_EMAILS_START_AT via the shared helper, not an ad hoc Date parse", () => {
    expect(source).toContain("parseSignupEmailsStartAt(");
    expect(source).toContain("SIGNUP_EMAILS_START_AT_ENV");
  });

  it("calls ensureLifecycleRows and claimAndSend from the shared service — no duplicated claim/send logic", () => {
    expect(source).toContain("ensureLifecycleRows(");
    expect(source).toContain("claimAndSend(");
    expect(source).toContain('from "@/lib/lifecycle-emails/service"');
  });

  it("only ever attempts the welcome email type from this endpoint", () => {
    expect(source).toMatch(/c\.email_type === "welcome"/);
  });
});

describe("welcome endpoint: generic response, no disclosure of internal state", () => {
  it("returns the same GENERIC_OK constant on every non-auth outcome, including inside the catch block", () => {
    const postBody = source.slice(source.indexOf("export async function POST"));
    // Only one literal 200 response shape should exist besides the 401s.
    const genericDeclarationCount = (source.match(/const GENERIC_OK/g) ?? []).length;
    expect(genericDeclarationCount).toBe(1);
    expect(postBody).toContain("return GENERIC_OK;");
  });

  it("swallows any thrown error into the generic response rather than a 500 with detail", () => {
    const postBody = source.slice(source.indexOf("export async function POST"));
    expect(postBody).toMatch(/catch\s*\{/);
    expect(postBody).not.toMatch(/catch \(e/); // never captures/re-surfaces the error object here
  });

  it("does not make a successful send a precondition for returning success", () => {
    // claimAndSend's result is awaited but never captured/branched on in
    // the POST handler — its outcome never changes the response.
    const postBody = source.slice(source.indexOf("export async function POST"));
    expect(postBody).not.toMatch(/=\s*await claimAndSend/);
    expect(postBody).not.toContain(".outcome");
    expect(postBody).toContain("await claimAndSend(supabaseAdmin, welcomeCandidate);");
  });
});

describe("welcome endpoint: no lifecycle-email business logic duplicated here", () => {
  it("does not import Resend directly or build an email itself", () => {
    expect(source).not.toMatch(/from ["']resend["']/);
    expect(source).not.toContain("buildWelcomeEmail");
    expect(source).not.toContain("sendEmail(");
  });

  it("never builds its own idempotency key — the shared claimAndSend()/buildLifecycleEmailIdempotencyKey() in service.ts is the only source of one", () => {
    expect(source).not.toContain("idempotencyKey");
    expect(source).not.toContain("buildLifecycleEmailIdempotencyKey");
  });
});
