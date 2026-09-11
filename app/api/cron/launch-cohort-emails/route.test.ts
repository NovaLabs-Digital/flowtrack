import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// No request-mocking harness in this repo; source-content assertions,
// matching app/api/cron/signup-emails/route.test.ts's own conventions.
const source = readFileSync(join(__dirname, "./route.ts"), "utf-8");

describe("launch-cohort-emails cron: auth matches the existing CRON_SECRET convention exactly", () => {
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

describe("launch-cohort-emails cron: campaign-start configuration fails closed for the whole run, before any Supabase access", () => {
  function earlyReturnBlock(): string {
    const start = source.indexOf("if (campaignStart === null) {");
    const end = source.indexOf("\n  }\n", start);
    return source.slice(start, end);
  }

  it("checks campaignStart as the very first thing in runLaunchCohortEmails, before parsing dryRun/userId is the only thing that precedes it", () => {
    const runBody = source.slice(
      source.indexOf("async function runLaunchCohortEmails"),
      source.indexOf("export async function GET")
    );
    const cutoffCheckIndex = runBody.indexOf("if (campaignStart === null) {");
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
      "ensureLaunchCohortRows(",
      "findActiveMembers(",
    ]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("the early-return response reports the untouched zero default for suppressed, not a freshly queried value", () => {
    const block = earlyReturnBlock();
    expect(block).not.toMatch(/summary\.suppressed\s*=/);
    expect(block).toContain("...summary");
  });

  it("the cutoff-missing response still reports dryRun and the summary shape, not a bare error", () => {
    const block = earlyReturnBlock();
    expect(block).toContain("...summary");
    expect(block).toMatch(/dryRun:\s*true/);
  });

  it("one gate covers both a missing and an invalid campaign start — parseLaunchCohortStartAt already collapses both to null", () => {
    expect(source).toContain("parseLaunchCohortStartAt(process.env[LAUNCH_COHORT_START_AT_ENV])");
    expect((source.match(/campaignStart === null/g) ?? []).length).toBe(1);
  });

  it("uses its own distinct env var name, never the signup lifecycle sequence's SIGNUP_EMAILS_START_AT", () => {
    expect(source).toContain("LAUNCH_COHORT_START_AT_ENV");
    expect(source).not.toContain("SIGNUP_EMAILS_START_AT");
  });
});

describe("launch-cohort-emails cron: this campaign is separate — never touches lifecycle_emails or its tables", () => {
  it("never references the lifecycle_emails table or its RPCs", () => {
    expect(source).not.toContain("lifecycle_emails");
    expect(source).not.toContain("claim_lifecycle_email");
    expect(source).not.toContain("complete_lifecycle_email");
  });

  it("imports exclusively from lib/launch-cohort/, not lib/lifecycle-emails/", () => {
    expect(source).toMatch(/from "@\/lib\/launch-cohort\/service"/);
    expect(source).toMatch(/from "@\/lib\/launch-cohort\/eligibility"/);
    expect(source).not.toMatch(/from "@\/lib\/lifecycle-emails/);
  });
});

describe("launch-cohort-emails cron: discovery reads only the explicit roster, never all of auth.users", () => {
  it("calls findActiveMembers (the roster table), not auth.admin.listUsers", () => {
    expect(source).toContain("findActiveMembers(supabaseAdmin");
    expect(source).not.toContain("listUsers(");
  });

  it("resolves each roster member server-side via getUserById, never trusting a stored email", () => {
    expect(source).toContain("supabaseAdmin.auth.admin.getUserById(member.userId)");
  });
});

describe("launch-cohort-emails cron: dryRun never claims, mutates, or sends", () => {
  it("passes dryRun straight through to claimAndSend, and claimAndSend's own dryRun branch (in service.ts) short-circuits before any RPC", () => {
    expect(source).toMatch(/claimAndSend\(supabaseAdmin, candidate, \{ dryRun \}\)/);
  });

  it("dryRun is echoed in the response so a caller can confirm which mode ran", () => {
    expect(source).toMatch(/\.\.\.\(dryRun \? \{ dryRun: true \} : \{\}\)/);
  });
});

describe("launch-cohort-emails cron: userId scoping (single-user test mode) still resolves the recipient server-side", () => {
  it("scopes roster discovery to the given userId", () => {
    expect(source).toContain("findActiveMembers(supabaseAdmin, { userId: onlyUserId })");
  });

  it("scopes candidate discovery to the given userId without skipping server-side resolution", () => {
    expect(source).toContain("findCandidateRows(supabaseAdmin, { userId: onlyUserId })");
  });
});

describe("launch-cohort-emails cron: per-row isolation", () => {
  it("wraps each row's claimAndSend in its own try/catch so one failure cannot abort the batch", () => {
    const loopBody = source.slice(
      source.indexOf("for (const candidate of candidates)"),
      source.indexOf("return NextResponse.json({\n    ...summary,")
    );
    expect(loopBody).toMatch(/try \{/);
    expect(loopBody).toMatch(/catch \(err\) \{/);
  });

  it("wraps each roster member's ensureLaunchCohortRows in its own try/catch inside discoverAndEnsureRows", () => {
    const discoveryBody = source.slice(
      source.indexOf("async function discoverAndEnsureRows"),
      source.indexOf("async function runLaunchCohortEmails")
    );
    expect(discoveryBody).toMatch(/try \{/);
    expect(discoveryBody).toMatch(/catch \(err\) \{/);
  });
});

describe("launch-cohort-emails cron: suppressed is a real, scope-aware observability count", () => {
  it("populates summary.suppressed from countSuppressedRows, not a per-row switch case", () => {
    expect(source).toContain("countSuppressedRows(supabaseAdmin, { userId: onlyUserId })");
    expect(source).not.toMatch(/case "suppressed":/);
  });

  it("computes it identically for dry-run and real-run, before the dryRun-dependent send loop", () => {
    const suppressedCallIndex = source.indexOf("summary.suppressed = await countSuppressedRows(");
    const loopIndex = source.indexOf("for (const candidate of candidates)");
    expect(suppressedCallIndex).toBeGreaterThan(-1);
    expect(suppressedCallIndex).toBeLessThan(loopIndex);
  });

  it("is only computed once campaignStart is known valid — never queried merely to populate a run that sends nothing", () => {
    const suppressedCallIndex = source.indexOf("summary.suppressed = await countSuppressedRows(");
    const cutoffCheckIndex = source.indexOf("if (campaignStart === null) {");
    expect(suppressedCallIndex).toBeGreaterThan(cutoffCheckIndex);
  });
});

describe("launch-cohort-emails cron: shares the one centralized idempotency-key helper, builds no key of its own", () => {
  it("never references idempotencyKey or builds a key directly in the route", () => {
    expect(source).not.toContain("idempotencyKey");
    expect(source).not.toContain("buildLaunchCohortEmailIdempotencyKey");
  });
});

describe("launch-cohort-emails cron: summary counters and no sensitive logging", () => {
  it("returns the required summary keys", () => {
    for (const key of ["discovered", "eligible", "claimed", "sent", "skipped", "suppressed", "failed", "exhausted"]) {
      expect(source).toContain(`summary.${key}`);
    }
    expect(source).toContain("emptyLaunchCohortRunSummary()");
  });

  it("never logs a full email address or name — only userId/rowId and error text", () => {
    const consoleCalls = source.match(/console\.(error|log|warn)\([^)]*\)/g) ?? [];
    for (const call of consoleCalls) {
      const codeOnly = call
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).not.toMatch(/\bemail\b/i);
      expect(codeOnly).not.toMatch(/@/);
    }
  });

  it("never logs an access token, API key, or provider secret", () => {
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*token/i);
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*RESEND_API_KEY/i);
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*CRON_SECRET/i);
  });
});

describe("launch-cohort-emails cron: never invokes a cron job manually from within its own code, and no inbound-email automation", () => {
  it("contains no fetch()/invocation of another cron route", () => {
    expect(source).not.toMatch(/fetch\(.*\/api\/cron\//);
  });

  it("contains no inbound-email/webhook parsing (STOP handling stays manual, per the runbook)", () => {
    expect(source).not.toMatch(/webhook/i);
    expect(source).not.toMatch(/inbound/i);
  });
});
