import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-content assertions, following this repo's convention (see
// login/page.test.ts, mfa-challenge/page.test.ts).
const source = readFileSync(join(__dirname, "./page.tsx"), "utf-8");

function body(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("auth/confirm page: reads and validates callback parameters", () => {
  it("reads token_hash and type from the query string", () => {
    const runBody = body("async function run", "run();");
    expect(runBody).toContain('searchParams?.get("token_hash")');
    expect(runBody).toContain('searchParams?.get("type")');
  });

  it("restricts type to signup/email only, not an arbitrary EmailOtpType", () => {
    expect(source).toMatch(/ALLOWED_TYPES\s*=\s*new Set<string>\(\["signup",\s*"email"\]\)/);
  });

  it("falls back to the existing-session check when token_hash or type is missing/invalid", () => {
    const runBody = body("async function run", "run();");
    const guardIndex = runBody.indexOf("if (!tokenHash || !isAllowedType(type)) {");
    const fallbackIndex = runBody.indexOf("await continueWithExistingSessionOrShowInvalid();");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(fallbackIndex);
  });
});

describe("auth/confirm page: verifies via the installed package's documented token_hash API", () => {
  it("calls supabase.auth.verifyOtp with token_hash and type, not exchangeCodeForSession", () => {
    expect(source).toMatch(/supabase\.auth\.verifyOtp\(\{\s*token_hash:\s*tokenHash,\s*type,?\s*\}\)/);
    expect(source).not.toContain("exchangeCodeForSession");
  });

  it("checks for an error/missing session before redirecting on success", () => {
    const runBody = body("async function run", "run();");
    const verifyIndex = runBody.indexOf("verifyOtp(");
    const errorCheckIndex = runBody.indexOf("if (error || !data.session) {");
    const successRedirectIndex = runBody.lastIndexOf('router.replace("/dashboard")');
    expect(verifyIndex).toBeLessThan(errorCheckIndex);
    expect(errorCheckIndex).toBeLessThan(successRedirectIndex);
  });

  it("never surfaces error.message from a failed verification", () => {
    const runBody = body("async function run", "run();");
    expect(runBody).not.toMatch(/error\.message/);
  });
});

describe("auth/confirm page: already-authenticated / duplicate-link / refresh handling", () => {
  it("has a single fallback path that checks for an existing session before showing an error", () => {
    const fallbackBody = body(
      "async function continueWithExistingSessionOrShowInvalid",
      "async function run"
    );
    expect(fallbackBody).toContain("supabase.auth.getSession()");
    expect(fallbackBody).toMatch(/if \(data\?\.session\) \{/);
    expect(fallbackBody).toContain('router.replace("/dashboard")');
    expect(fallbackBody).toContain('setStatus("invalid")');
  });

  it("routes an already-authenticated or already-consumed-link user onward instead of erroring", () => {
    // Both the "missing/invalid params" branch and the "verifyOtp failed"
    // branch funnel through the same existing-session fallback, so a
    // duplicate click by an already-signed-in user (or a page refresh after
    // the token was already consumed) lands on /dashboard, not an error.
    const occurrences = source.split(
      "await continueWithExistingSessionOrShowInvalid();"
    ).length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("auth/confirm page: invalid/expired state UI", () => {
  it("shows a generic invalid/expired message, not a Supabase-specific one", () => {
    expect(source).toMatch(/invalid or has expired/i);
  });

  it("offers a way back to signup and a way back to login", () => {
    const invalidUiBlock = source.slice(source.indexOf("Link invalid or expired"));
    expect(invalidUiBlock.length).toBeGreaterThan(0);
    expect(invalidUiBlock).toContain('href="/signup"');
    expect(invalidUiBlock).toContain('href="/login"');
  });
});

describe("auth/confirm page: scrubs the confirmation secret from the visible URL", () => {
  it("calls history.replaceState immediately after reading the params, before verifyOtp or the session fallback", () => {
    const runBody = body("async function run", "run();");
    const tokenReadIndex = runBody.indexOf('searchParams?.get("token_hash")');
    const replaceStateIndex = runBody.indexOf("window.history.replaceState(");
    const guardIndex = runBody.indexOf(
      "if (!tokenHash || !isAllowedType(type)) {"
    );
    const verifyIndex = runBody.indexOf("verifyOtp(");

    expect(replaceStateIndex).toBeGreaterThan(-1);
    expect(tokenReadIndex).toBeLessThan(replaceStateIndex);
    expect(replaceStateIndex).toBeLessThan(guardIndex);
    expect(replaceStateIndex).toBeLessThan(verifyIndex);
  });

  it("replaces the URL with the bare pathname, dropping the query string entirely", () => {
    expect(source).toContain(
      'window.history.replaceState(null, "", window.location.pathname);'
    );
  });

  it("never renders or logs the token hash", () => {
    expect(source).not.toMatch(/console\.(log|error|warn)/);
    expect(source).not.toMatch(/\{tokenHash\}/);
    expect(source).not.toMatch(/\$\{tokenHash\}/);
  });
});

describe("auth/confirm page: documents the correct Dashboard template configuration", () => {
  it("documents the exact Confirm Signup template link using {{ .RedirectTo }}, not {{ .SiteURL }}", () => {
    expect(source).toContain(
      "{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"
    );
  });

  it("explicitly explains why {{ .SiteURL }} is wrong given emailRedirectTo is already supplied", () => {
    expect(source).toMatch(/rather than `\{\{ \.SiteURL \}\}`/);
  });

  it("does not instruct appending /auth/confirm again on top of {{ .RedirectTo }}", () => {
    const templateLineIndex = source.indexOf(
      "{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"
    );
    const templateLine = source.slice(templateLineIndex, templateLineIndex + 60);
    expect(templateLine).not.toContain("/auth/confirm");
  });

  it("documents the exact production callback URL required in the Redirect URLs allowlist", () => {
    expect(source).toContain("https://www.appflowtrack.com/auth/confirm");
  });
});

describe("auth/confirm page: no redirect loop, no lifecycle-email infrastructure", () => {
  it("only ever navigates to a hardcoded, same-app path (/dashboard) — no dynamic next param", () => {
    expect(source).not.toContain("useSearchParams()?.get(\"next\")");
    expect(source).not.toContain("sanitizeNextPath");
    const replaceTargets = [...source.matchAll(/router\.replace\(([^)]*)\)/g)].map(
      (m) => m[1].trim()
    );
    expect(replaceTargets.length).toBeGreaterThan(0);
    for (const target of replaceTargets) {
      expect(target).toBe('"/dashboard"');
    }
  });

  it("triggers the immediate-welcome endpoint by fetch only — no Resend/cron/database code lives in this page itself", () => {
    // Deliberate, minimal wiring: a plain fetch to the protected endpoint,
    // authenticated with this page's own freshly-established session
    // token. Everything about *how* the welcome email is built, claimed,
    // and sent lives in lib/lifecycle-emails/service.ts and the route
    // itself — never duplicated here.
    expect(source).toMatch(/fetch\("\/api\/lifecycle-emails\/welcome"/);
    expect(source).toMatch(/Authorization:\s*`Bearer \$\{accessToken\}`/);
    // Comments may legitimately reference the cron route by path/name to
    // explain the retry guarantee; only executable code must never
    // actually touch Resend/Supabase-admin/lifecycle internals directly.
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/resend\.emails|RESEND_API_KEY|supabaseAdmin/i);
    expect(codeOnly).not.toMatch(/from ["']@\/lib\/lifecycle-emails\/service["']/);
    expect(codeOnly).not.toContain(".from(\"lifecycle_emails\")");
  });

  it("the welcome trigger is fire-and-forget: never awaited, and its rejection is caught so it can never throw into the confirm flow", () => {
    const triggerBody = source.slice(
      source.indexOf("function triggerWelcomeEmailBestEffort"),
      source.indexOf("export default function ConfirmEmailPage")
    );
    expect(triggerBody).toMatch(/\.catch\(/);

    const runBody = source.slice(source.indexOf("async function run("), source.indexOf("run();"));
    expect(runBody).not.toMatch(/await triggerWelcomeEmailBestEffort/);
    expect(runBody).toContain("triggerWelcomeEmailBestEffort(data.session.access_token);");
  });

  it("dashboard navigation does not wait on, or depend on the outcome of, the welcome trigger", () => {
    const runBody = source.slice(source.indexOf("async function run("), source.indexOf("run();"));
    const triggerIndex = runBody.indexOf("triggerWelcomeEmailBestEffort(");
    const navigateIndex = runBody.indexOf('router.replace("/dashboard")');
    expect(triggerIndex).toBeGreaterThan(-1);
    expect(navigateIndex).toBeGreaterThan(triggerIndex);
  });

  it("sets keepalive: true on the fetch, and documents that it improves but does not guarantee delivery", () => {
    const triggerBody = source.slice(
      source.indexOf("function triggerWelcomeEmailBestEffort"),
      source.indexOf("export default function ConfirmEmailPage")
    );
    expect(triggerBody).toMatch(/keepalive:\s*true/);
    expect(source).toMatch(/does not guarantee delivery/);
  });

  it("the request still carries no body — only the Authorization header identifies the caller", () => {
    const triggerBody = source.slice(
      source.indexOf("function triggerWelcomeEmailBestEffort"),
      source.indexOf("export default function ConfirmEmailPage")
    );
    expect(triggerBody).not.toMatch(/body:/);
    expect(triggerBody).not.toMatch(/JSON\.stringify/);
    // \b avoids false-flagging the route path itself ("lifecycle-emails").
    expect(triggerBody).not.toMatch(/\bemail\b/i);
    expect(triggerBody).not.toMatch(/userId/);
  });

  it("wraps useSearchParams in a Suspense boundary, matching the mfa-challenge/login convention", () => {
    const defaultExport = source.slice(
      source.indexOf("export default function ConfirmEmailPage"),
      source.indexOf("function ConfirmEmailForm")
    );
    expect(defaultExport).toContain("<Suspense");
  });
});
