import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-content assertions on the never-executed migration SQL, following
// this repo's established convention (see migration_lifecycle_emails.test.ts).
const migrationPath = join(__dirname, "migration_launch_cohort.sql");
const migration = readFileSync(migrationPath, "utf-8");

const runbookPath = join(__dirname, "launch_cohort_runbook.sql");
const runbook = readFileSync(runbookPath, "utf-8");

function executableLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migration_launch_cohort.sql: transaction shape", () => {
  it("has exactly one BEGIN and one COMMIT, no ROLLBACK", () => {
    const exec = executableLines(migration);
    expect((exec.match(/\bBEGIN;/g) ?? []).length).toBe(1);
    expect((exec.match(/\bCOMMIT;/g) ?? []).length).toBe(1);
    expect(exec).not.toMatch(/\bROLLBACK;/);
  });

  it("preflight is the first executable statement after BEGIN", () => {
    const beginIndex = migration.indexOf("BEGIN;");
    const preflightIndex = migration.indexOf("DO $launch_cohort_migration_preflight$");
    const between = migration.slice(beginIndex + "BEGIN;".length, preflightIndex);
    const nonCommentLines = between
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(nonCommentLines).toEqual([]);
  });
});

describe("migration_launch_cohort.sql: preflight verifies real facts, not assumptions", () => {
  it("checks current_user, postgres.rolbypassrls, service_role existence, and auth.users.id type", () => {
    const preflightBody = migration.slice(
      migration.indexOf("DO $launch_cohort_migration_preflight$"),
      migration.indexOf("$launch_cohort_migration_preflight$;") + 1
    );
    expect(preflightBody).toMatch(/current_user\s*<>\s*'postgres'/);
    expect(preflightBody).toMatch(/rolbypassrls/);
    expect(preflightBody).toMatch(/rolname\s*=\s*'service_role'/);
    expect(preflightBody).toMatch(/nspname\s*=\s*'auth'\s*AND\s*c\.relname\s*=\s*'users'/);
  });

  it("fails loudly rather than silently proceeding if either table already exists", () => {
    const preflightBody = migration.slice(
      migration.indexOf("DO $launch_cohort_migration_preflight$"),
      migration.indexOf("$launch_cohort_migration_preflight$;") + 1
    );
    expect(preflightBody).toMatch(/v_members_table_exists\s+THEN/);
    expect(preflightBody).toMatch(/RAISE EXCEPTION 'Preflight failed: public\.launch_cohort_members already exists/);
    expect(preflightBody).toMatch(/v_emails_table_exists\s+THEN/);
    expect(preflightBody).toMatch(/RAISE EXCEPTION 'Preflight failed: public\.launch_cohort_emails already exists/);
  });
});

describe("migration_launch_cohort.sql: table shape", () => {
  it("creates public.launch_cohort_members with the required columns", () => {
    expect(migration).toMatch(/CREATE TABLE public\.launch_cohort_members/);
    for (const column of ["user_id", "enrolled_at", "enrolled_by", "suppressed_at", "suppression_reason", "created_at", "updated_at"]) {
      const membersSection = migration.slice(
        migration.indexOf("CREATE TABLE public.launch_cohort_members"),
        migration.indexOf("COMMENT ON TABLE public.launch_cohort_members")
      );
      expect(membersSection).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("launch_cohort_members.user_id is the primary key and references auth.users(id) with ON DELETE CASCADE", () => {
    expect(migration).toMatch(/user_id\s+uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });

  it("launch_cohort_members.enrolled_by cannot be blank", () => {
    expect(migration).toMatch(/CHECK \(btrim\(enrolled_by\) <> ''\)/);
  });

  it("creates public.launch_cohort_emails with the required columns", () => {
    expect(migration).toMatch(/CREATE TABLE public\.launch_cohort_emails/);
    for (const column of [
      "id", "user_id", "email_type", "status", "eligible_at", "attempt_count",
      "last_attempt_at", "next_attempt_at", "locked_until", "claim_token",
      "sent_at", "provider_message_id", "last_error", "suppressed_at",
      "suppression_reason", "created_at", "updated_at",
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("launch_cohort_emails.user_id references auth.users(id) with ON DELETE CASCADE", () => {
    expect(migration).toMatch(/user_id\s+uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });

  it("constrains email_type to exactly the four campaign types", () => {
    expect(migration).toMatch(/CHECK \(email_type IN \('welcome', 'story', 'routine', 'checkin'\)\)/);
  });

  it("constrains status to the explicit state model", () => {
    expect(migration).toMatch(
      /CHECK \(status IN \('pending', 'processing', 'sent', 'failed', 'suppressed', 'exhausted'\)\)/
    );
  });

  it("enforces UNIQUE(user_id, email_type) on launch_cohort_emails", () => {
    expect(migration).toMatch(/UNIQUE \(user_id, email_type\)/);
  });

  it("uses distinct email types from the signup lifecycle sequence — never 'welcome'/'feedback_48h'/'checkin_7d' collide with lifecycle_emails' own values in a way that could cross-wire the two systems", () => {
    expect(migration).not.toMatch(/'feedback_48h'/);
    expect(migration).not.toMatch(/'checkin_7d'/);
  });
});

describe("migration_launch_cohort.sql: security posture — the service_role REVOKE lesson applied from the start", () => {
  it("enables RLS on both tables but does not force it", () => {
    expect(migration).toMatch(/ALTER TABLE public\.launch_cohort_members ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/ALTER TABLE public\.launch_cohort_emails ENABLE ROW LEVEL SECURITY;/);
    expect(executableLines(migration)).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("creates zero policies on either table", () => {
    expect(migration).not.toMatch(/CREATE POLICY/);
  });

  it("every REVOKE ALL explicitly includes service_role, not just PUBLIC/anon/authenticated", () => {
    const revokeAllLines = migration
      .split("\n")
      .filter((l) => /^REVOKE ALL ON TABLE/.test(l.trim()));
    expect(revokeAllLines.length).toBe(2);
    for (const line of revokeAllLines) {
      expect(line).toMatch(/\bservice_role\b/);
    }
  });

  it("launch_cohort_members: service_role gets exactly SELECT, UPDATE — never INSERT or DELETE (enrollment is human-only)", () => {
    expect(migration).toMatch(/GRANT SELECT, UPDATE ON TABLE public\.launch_cohort_members TO service_role;/);
    const grantLines = migration.split("\n").filter((l) => /GRANT .* ON TABLE public\.launch_cohort_members/.test(l));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\bINSERT\b/);
      expect(line).not.toMatch(/\bDELETE\b/);
    }
  });

  it("launch_cohort_emails: service_role gets exactly SELECT, INSERT, UPDATE — never DELETE", () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.launch_cohort_emails TO service_role;/);
    const grantLines = migration.split("\n").filter((l) => /GRANT .* ON TABLE public\.launch_cohort_emails/.test(l));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\bDELETE\b/);
    }
  });

  it("never grants anything to authenticated or anon on either table", () => {
    const tableGrantLines = migration
      .split("\n")
      .filter((l) => /GRANT .* ON TABLE public\.launch_cohort_(members|emails)/.test(l));
    for (const line of tableGrantLines) {
      expect(line).not.toMatch(/\banon\b/);
      expect(line).not.toMatch(/\bauthenticated\b/);
    }
  });
});

describe("migration_launch_cohort.sql: functions follow the mandatory privilege convention", () => {
  it("claim_launch_cohort_email and complete_launch_cohort_email are both created, revoked from PUBLIC/anon/authenticated/service_role, and granted only to service_role", () => {
    for (const fn of ["claim_launch_cohort_email", "complete_launch_cohort_email"]) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
  });

  it("both functions set search_path = '' (SECURITY DEFINER convention)", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_launch_cohort_email")
    );
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_launch_cohort_email")
    );
    expect(claimBody).toMatch(/SECURITY DEFINER/);
    expect(claimBody).toMatch(/SET search_path = ''/);
    expect(completeBody).toMatch(/SECURITY DEFINER/);
    expect(completeBody).toMatch(/SET search_path = ''/);
  });
});

describe("migration_launch_cohort.sql: claim_launch_cohort_email is a single atomic statement", () => {
  it("claims via one UPDATE ... WHERE ... RETURNING, not a SELECT-then-UPDATE", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_launch_cohort_email")
    );
    expect(claimBody).toMatch(/UPDATE public\.launch_cohort_emails/);
    expect(claimBody).toMatch(/RETURNING/);
    expect(claimBody).not.toMatch(/SELECT[^;]*FOR UPDATE/);
  });

  it("excludes terminal states and respects eligible_at, next_attempt_at, and the lease", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_launch_cohort_email")
    );
    expect(claimBody).toMatch(/status NOT IN \('sent', 'exhausted', 'suppressed'\)/);
    expect(claimBody).toMatch(/eligible_at <= now\(\)/);
    expect(claimBody).toMatch(/next_attempt_at IS NULL OR lce\.next_attempt_at <= now\(\)/);
    expect(claimBody).toMatch(/locked_until IS NULL OR lce\.locked_until < now\(\)/);
  });
});

describe("migration_launch_cohort.sql: complete_launch_cohort_email enforces claim-token ownership", () => {
  it("requires a matching claim_token and status = processing in its WHERE clause", () => {
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_launch_cohort_email")
    );
    expect(completeBody).toMatch(/lce\.claim_token = p_claim_token/);
    expect(completeBody).toMatch(/lce\.status = 'processing'/);
    expect(completeBody).toMatch(/GET DIAGNOSTICS v_row_count = ROW_COUNT/);
    expect(completeBody).toMatch(/RETURN v_row_count > 0/);
  });

  it("only accepts sent, failed, or exhausted as a terminal status", () => {
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_launch_cohort_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_launch_cohort_email")
    );
    expect(completeBody).toMatch(/p_status NOT IN \('sent', 'failed', 'exhausted'\)/);
  });
});

describe("migration_launch_cohort.sql: never touches unrelated objects", () => {
  it("never modifies auth.users, auth.mfa_factors, or lifecycle_emails — only reads/references them in headers or FK declarations", () => {
    expect(migration).not.toMatch(/ALTER TABLE auth\.users/);
    expect(migration).not.toMatch(/ALTER TABLE auth\.mfa_factors/);
    expect(migration).not.toMatch(/UPDATE auth\.users/);
    expect(migration).not.toMatch(/INSERT INTO auth\.users/);
    expect(migration).not.toMatch(/DELETE FROM auth\.users/);
    // A header-comment mention explaining what this migration deliberately
    // does NOT touch is legitimate documentation, not an operation on it —
    // only an actual DDL/DML statement targeting lifecycle_emails would be
    // a real problem, and none exists in the executable SQL.
    expect(executableLines(migration)).not.toMatch(/lifecycle_emails/);
  });

  it("never touches a Phase 1C mfa_required_if_enrolled_* policy, Stripe/billing, or Bill Guardian's debts table", () => {
    expect(migration).not.toMatch(/mfa_required_if_enrolled/);
    // "Stripe" and "debts" are legitimately named in the header's own
    // scope-boundary prose (documenting what this migration does NOT
    // touch) — only executable SQL referencing them would be a problem.
    expect(executableLines(migration)).not.toMatch(/\bstripe\b/i);
    expect(executableLines(migration)).not.toMatch(/public\.debts/);
  });

  it("no malformed PUBLIC-ACL SELECT-INTO-scalar construct — the exact bug class that broke the lifecycle-emails runbook in production", () => {
    expect(migration).not.toMatch(/SELECT count\(\*\) INTO v_public/);
  });
});

describe("launch_cohort_runbook.sql: structure and safety", () => {
  it("contains Step 0 through Step 5 and the STOP-suppression appendix", () => {
    for (const marker of [
      "STEP 0: Baseline inventory",
      "STEP 1: Transactional dry run",
      "STEP 2: Real migration",
      "STEP 3: Post-migration verification",
      "STEP 4: Manual roster enrollment",
      "STEP 5: Narrow rollback",
      "APPENDIX: Manual STOP suppression",
    ]) {
      expect(runbook).toContain(marker);
    }
  });

  function step1Text(): string {
    return runbook.slice(
      runbook.indexOf("STEP 1: Transactional dry run"),
      runbook.indexOf("STEP 2: Real migration")
    );
  }

  it("Step 1 has exactly one BEGIN, one ROLLBACK, and zero COMMIT", () => {
    const step1 = step1Text();
    expect((step1.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((step1.match(/^ROLLBACK;$/gm) ?? []).length).toBe(1);
    expect(step1).not.toMatch(/^COMMIT;$/m);
  });

  it("Step 1 contains no placeholder or manual-splice instruction — the complete migration body is embedded inline", () => {
    expect(step1Text().toLowerCase()).not.toMatch(/paste the full contents/);
    expect(step1Text()).toMatch(/CREATE TABLE public\.launch_cohort_members/);
    expect(step1Text()).toMatch(/CREATE TABLE public\.launch_cohort_emails/);
    expect(step1Text()).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_launch_cohort_email\(/);
    expect(step1Text()).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_launch_cohort_email\(/);
  });

  it("Step 1's preflight is byte-for-byte identical to the migration's own preflight", () => {
    const step1 = step1Text();
    const migStart = migration.indexOf("BEGIN;") + "BEGIN;\n\n".length;
    const migEnd = migration.indexOf("$launch_cohort_migration_preflight$;") + "$launch_cohort_migration_preflight$;".length;
    const step1Start = step1.indexOf("BEGIN;") + "BEGIN;\n\n".length;
    const step1End = step1.indexOf("$launch_cohort_migration_preflight$;") + "$launch_cohort_migration_preflight$;".length;
    expect(step1.slice(step1Start, step1End)).toBe(migration.slice(migStart, migEnd));
  });

  it("Step 1's post-snapshot migration body is byte-for-byte identical to the migration's own body after its preflight", () => {
    const step1 = step1Text();
    const startMarker = "-- ---------------------------------------------------------------------\n-- A. public.launch_cohort_members";
    const endMarker = "GRANT EXECUTE ON FUNCTION public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz) TO service_role;";

    const migStart = migration.indexOf(startMarker);
    const migEnd = migration.indexOf(endMarker) + endMarker.length;
    const step1Start = step1.indexOf(startMarker);
    const step1End = step1.indexOf(endMarker) + endMarker.length;

    expect(migStart).toBeGreaterThan(-1);
    expect(step1Start).toBeGreaterThan(-1);
    expect(step1.slice(step1Start, step1End)).toBe(migration.slice(migStart, migEnd));
  });

  it("Step 1's PUBLIC-ACL checks use IF EXISTS(...), never a scalar SELECT INTO", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/IF EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM pg_class c/);
    expect(step1).not.toMatch(/SELECT count\(\*\) INTO v_public/);
  });

  it("Step 1 proves service_role cannot INSERT into launch_cohort_members", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/INSERT INTO public\.launch_cohort_members \(user_id, enrolled_by\) VALUES \(v_user_id, 'service_role_probe'\)/);
    expect(step1).toMatch(/WHEN insufficient_privilege THEN/);
    expect(step1).toMatch(/v_members_insert_rejected/);
  });

  it("Step 1 exercises the UNIQUE(user_id, email_type) constraint", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/EXCEPTION WHEN unique_violation THEN/);
  });

  it("Step 1's final verification reports six separately named boolean columns after ROLLBACK", () => {
    const step1 = step1Text();
    const afterRollback = step1.slice(step1.indexOf("ROLLBACK;"));
    for (const col of [
      "launch_cohort_members_absent",
      "launch_cohort_emails_absent",
      "claim_launch_cohort_email_absent",
      "complete_launch_cohort_email_absent",
      "public_table_count_matches_baseline_11",
      "public_policy_count_matches_baseline_25",
    ]) {
      expect(afterRollback).toContain(col);
    }
  });

  it("Step 4 (manual enrollment) is fully parameterized — no real email, name, or UUID is hardcoded", () => {
    const step4 = runbook.slice(
      runbook.indexOf("STEP 4: Manual roster enrollment"),
      runbook.indexOf("STEP 5: Narrow rollback")
    );
    expect(step4).toMatch(/<uuid-for-approved-user-1>/);
    expect(step4).not.toMatch(/@gmail\.com|@sbcglobal\.net|@albertocleaningservices\.com|@gnadconstruction\.com/);
    expect(step4).not.toMatch(/currentvernon/i);
    expect(step4).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
  });

  it("Step 5's narrow rollback drops only the two new tables and two new functions", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5: Narrow rollback"),
      runbook.indexOf("APPENDIX")
    );
    expect(step5).toMatch(/DROP FUNCTION IF EXISTS public\.claim_launch_cohort_email/);
    expect(step5).toMatch(/DROP FUNCTION IF EXISTS public\.complete_launch_cohort_email/);
    expect(step5).toMatch(/DROP TABLE IF EXISTS public\.launch_cohort_emails/);
    expect(step5).toMatch(/DROP TABLE IF EXISTS public\.launch_cohort_members/);
    expect(step5).not.toMatch(/DROP.*auth\./);
    // A prose mention of lifecycle_emails ("does not touch ... lifecycle_
    // emails") is legitimate documentation, not an operation on it — only
    // an actual DROP/ALTER/DELETE targeting it would be a real problem.
    expect(step5).not.toMatch(/(DROP|ALTER|DELETE|UPDATE|INSERT)[^;]*lifecycle_emails/);
  });

  it("the STOP suppression appendix requires a UUID, never a bare email match, and updates both tables", () => {
    const appendix = runbook.slice(runbook.indexOf("APPENDIX: Manual STOP suppression"));
    expect(appendix).toMatch(/WHERE user_id = '<paste-the-verified-uuid-here>'/);
    expect(appendix).not.toMatch(/WHERE\s+email\s*=/i);
    expect(appendix).toContain("UPDATE public.launch_cohort_emails");
    expect(appendix).toContain("UPDATE public.launch_cohort_members");
    // The appendix legitimately documents that no inbound-email automation
    // is built (the explicit requirement) — that prose mention of "inbound"
    // is expected. What must never appear is an actual webhook ROUTE/
    // endpoint definition processing inbound mail.
    expect(appendix).not.toMatch(/app\/api\/.*inbound/i);
    expect(appendix).toMatch(/no inbound-email automation is built/i);
  });

  it("never contains any of the real cohort emails/names/business accounts — this file is safe to commit", () => {
    for (const forbidden of [
      "@gmail.com", "@sbcglobal.net", "@albertocleaningservices.com", "@gnadconstruction.com",
      "Alessandro", "Viviane", "Christian Collett", "Stacy-Ann", "Osuide", "Vernon Current",
      "Kola Abraham", "Fabiano",
    ]) {
      expect(runbook).not.toContain(forbidden);
      expect(migration).not.toContain(forbidden);
    }
  });
});

describe("vercel.json: launch-cohort-emails cron added alongside the unmodified bill-reminders and signup-emails crons", () => {
  const vercelJson = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf-8")
  ) as { crons: { path: string; schedule: string }[] };

  it("adds the launch-cohort-emails cron on its own daily schedule, distinct from the other two crons' times", () => {
    const launchCohort = vercelJson.crons.find((c) => c.path === "/api/cron/launch-cohort-emails");
    expect(launchCohort).toBeDefined();
    expect(launchCohort?.schedule).toBe("45 13 * * *");
  });

  it("does not alter the pre-existing bill-reminders or signup-emails cron entries", () => {
    const billReminders = vercelJson.crons.find((c) => c.path === "/api/cron/bill-reminders");
    const signupEmails = vercelJson.crons.find((c) => c.path === "/api/cron/signup-emails");
    expect(billReminders?.schedule).toBe("0 12 * * *");
    expect(signupEmails?.schedule).toBe("17 */6 * * *");
  });
});

describe("launch-cohort-emails cron route: supports the HTTP method Vercel Cron uses", () => {
  const cronRouteSource = readFileSync(
    join(__dirname, "..", "..", "app", "api", "cron", "launch-cohort-emails", "route.ts"),
    "utf-8"
  );

  it("exports a GET handler — Vercel Cron invokes the configured path with GET", () => {
    expect(cronRouteSource).toMatch(/export async function GET\(/);
  });

  it("GET is authorized the same way as POST, not left open", () => {
    const getBody = cronRouteSource.slice(
      cronRouteSource.indexOf("export async function GET"),
      cronRouteSource.indexOf("export async function POST")
    );
    expect(getBody).toMatch(/if \(!isAuthorized\(req\)\) \{/);
  });
});
