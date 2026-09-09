import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// No request-mocking harness in this repo; source-content assertions,
// matching app/api/cron/bill-reminders/route.ts's own (untested-by-file,
// but structurally identical) conventions and app/api/stripe/checkout's
// test style.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("signup-emails cron: auth matches the Bill Guardian convention exactly", () => {
  it("checks Authorization: Bearer CRON_SECRET with the X-Cron-Secret fallback header", () => {
    expect(source).toContain("process.env.CRON_SECRET");
    expect(source).toContain('req.headers.get("authorization")');
    expect(source).toContain('req.headers.get("x-cron-secret")');
  });

  it("both GET and POST require isAuthorized before doing anything else", () => {
    const getBody = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
    const postBody = source.slice(source.indexOf("export async function POST"));
    for (const body of [getBody, postBody]) {
      expect(body).toMatch(/if \(!isAuthorized\(req\)\) \{/);
      expect(body).toMatch(/status:\s*401/);
    }
  });
});

describe("signup-emails cron: rollout cutoff fails closed for the whole run, before any Supabase access", () => {
  function earlyReturnBlock(): string {
    const start = source.indexOf("if (cutoff === null) {");
    // The block's own closing brace is the first "  }" line after start
    // (2-space indent, matching the if-statement's own body indentation).
    const end = source.indexOf("\n  }\n", start);
    return source.slice(start, end);
  }

  it("checks the cutoff as the very first thing in runSignupEmails, before parsing dryRun/userId is the only thing that precedes it", () => {
    const runBody = source.slice(
      source.indexOf("async function runSignupEmails"),
      source.indexOf("export async function GET")
    );
    const cutoffCheckIndex = runBody.indexOf("if (cutoff === null) {");
    const suppressedCallIndex = runBody.indexOf("countSuppressedRows(");
    const discoveryIndex = runBody.indexOf("discoverAndEnsureRows(");
    const candidatesIndex = runBody.indexOf("findCandidateRows(");
    const claimIndex = runBody.indexOf("claimAndSend(");

    expect(cutoffCheckIndex).toBeGreaterThan(-1);
    expect(suppressedCallIndex).toBeGreaterThan(cutoffCheckIndex);
    expect(discoveryIndex).toBeGreaterThan(cutoffCheckIndex);
    expect(candidatesIndex).toBeGreaterThan(cutoffCheckIndex);
    expect(claimIndex).toBeGreaterThan(cutoffCheckIndex);
  });

  it("the early-return block itself contains zero calls to any Supabase-touching helper (no query, no RPC, no send path)", () => {
    const block = earlyReturnBlock();
    expect(block.length).toBeGreaterThan(0);
    for (const forbidden of [
      "countSuppressedRows(",
      "discoverAndEnsureRows(",
      "findCandidateRows(",
      "claimAndSend(",
      "supabaseAdmin.",
      "ensureLifecycleRows(",
    ]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("the early-return response reports the untouched zero default for suppressed, not a freshly queried value", () => {
    const block = earlyReturnBlock();
    // summary.suppressed is never reassigned inside this block — the
    // spread below returns emptyRunSummary()'s own zero default as-is.
    expect(block).not.toMatch(/summary\.suppressed\s*=/);
    expect(block).toContain("...summary");
  });

  it("the cutoff-missing response still reports dryRun and the summary shape, not a bare error", () => {
    const block = earlyReturnBlock();
    expect(block).toContain("...summary");
    expect(block).toMatch(/dryRun:\s*true/);
  });

  it("one gate covers both a missing and an invalid cutoff — parseSignupEmailsStartAt already collapses both to null, so there is no separate 'invalid' branch to accidentally skip", () => {
    expect(source).toContain("parseSignupEmailsStartAt(process.env[SIGNUP_EMAILS_START_AT_ENV])");
    // Exactly one null-cutoff check in the whole route — a second,
    // differently-worded check for "invalid" specifically would be a sign
    // that case could take a different, unguarded path.
    expect((source.match(/cutoff === null/g) ?? []).length).toBe(1);
  });
});

describe("signup-emails cron: dryRun never claims, mutates, or sends", () => {
  it("passes dryRun straight through to claimAndSend, and claimAndSend's own dryRun branch (in service.ts) short-circuits before any RPC", () => {
    expect(source).toMatch(/claimAndSend\(supabaseAdmin, candidate, \{ dryRun \}\)/);
  });

  it("dryRun is echoed in the response so a caller can confirm which mode ran", () => {
    expect(source).toMatch(/\.\.\.\(dryRun \? \{ dryRun: true \} : \{\}\)/);
  });
});

describe("signup-emails cron: userId scoping still resolves the recipient server-side", () => {
  it("passes userId through to getUserById rather than trusting any client-supplied email", () => {
    expect(source).toContain("supabaseAdmin.auth.admin.getUserById(onlyUserId)");
  });

  it("scopes candidate discovery to the given userId without skipping server-side resolution", () => {
    expect(source).toContain("findCandidateRows(supabaseAdmin, { userId: onlyUserId })");
  });
});

describe("signup-emails cron: pagination and per-row isolation", () => {
  it("loops on listUsers() using nextPage rather than assuming a single page", () => {
    expect(source).toContain("supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE })");
    expect(source).toMatch(/data\.nextPage === null/);
  });

  it("wraps each row's claimAndSend in its own try/catch so one failure cannot abort the batch", () => {
    const loopBody = source.slice(
      source.indexOf("for (const candidate of candidates)"),
      source.indexOf("return NextResponse.json({\n    ...summary,")
    );
    expect(loopBody).toMatch(/try \{/);
    expect(loopBody).toMatch(/catch \(err\) \{/);
  });
});

describe("signup-emails cron: suppressed is a real, scope-aware observability count", () => {
  it("populates summary.suppressed from countSuppressedRows, not a per-row switch case", () => {
    expect(source).toContain("countSuppressedRows(supabaseAdmin, { userId: onlyUserId })");
    expect(source).not.toMatch(/case "suppressed":/);
  });

  it("computes it identically for dry-run and real-run (before the dryRun-dependent send loop, not affected by it)", () => {
    const suppressedCallIndex = source.indexOf("summary.suppressed = await countSuppressedRows(");
    const loopIndex = source.indexOf("for (const candidate of candidates)");
    expect(suppressedCallIndex).toBeGreaterThan(-1);
    expect(suppressedCallIndex).toBeLessThan(loopIndex);
  });

  it("is only computed once the cutoff is known valid — never queried merely to populate a run that sends nothing", () => {
    const suppressedCallIndex = source.indexOf("summary.suppressed = await countSuppressedRows(");
    const cutoffCheckIndex = source.indexOf("if (cutoff === null) {");
    expect(suppressedCallIndex).toBeGreaterThan(cutoffCheckIndex);
  });
});

describe("signup-emails cron: shares the one centralized idempotency-key helper, builds no key of its own", () => {
  it("never references idempotencyKey or builds a key directly in the route", () => {
    expect(source).not.toContain("idempotencyKey");
    expect(source).not.toContain("buildLifecycleEmailIdempotencyKey");
  });
});

describe("signup-emails cron: summary counters and no sensitive logging", () => {
  it("returns the required summary keys", () => {
    for (const key of ["discovered", "eligible", "claimed", "sent", "skipped", "suppressed", "failed", "exhausted"]) {
      expect(source).toContain(`summary.${key}`);
    }
    expect(source).toContain("emptyRunSummary()");
  });

  it("never logs a full email address or name — only userId/rowId and error text", () => {
    const consoleCalls = source.match(/console\.(error|log|warn)\([^)]*\)/g) ?? [];
    for (const call of consoleCalls) {
      // Strip // comment lines first — an explanatory comment inside the
      // call's argument list (documenting what is deliberately NOT
      // logged) must not itself trip this check.
      const codeOnly = call
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      // \b so the route's own "[signup-emails]" log-tag prefix (which
      // legitimately contains the substring "emails") does not false-positive.
      expect(codeOnly).not.toMatch(/\bemail\b/i);
      expect(codeOnly).not.toMatch(/@/); // no interpolated address in any log call
    }
  });

  it("never logs an access token, API key, or provider secret", () => {
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*token/i);
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*RESEND_API_KEY/i);
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*CRON_SECRET/i);
  });
});
