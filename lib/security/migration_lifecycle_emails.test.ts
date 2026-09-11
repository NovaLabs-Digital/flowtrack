import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-content assertions on the never-executed migration SQL, following
// this repo's established convention (see migration_mfa_enforcement.test.ts).
const migrationPath = join(__dirname, "migration_lifecycle_emails.sql");
const migration = readFileSync(migrationPath, "utf-8");

const runbookPath = join(__dirname, "lifecycle_emails_runbook.sql");
const runbook = readFileSync(runbookPath, "utf-8");

function executableLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migration_lifecycle_emails.sql: transaction shape", () => {
  it("has exactly one BEGIN and one COMMIT, no ROLLBACK", () => {
    const exec = executableLines(migration);
    expect((exec.match(/\bBEGIN;/g) ?? []).length).toBe(1);
    expect((exec.match(/\bCOMMIT;/g) ?? []).length).toBe(1);
    expect(exec).not.toMatch(/\bROLLBACK;/);
  });

  it("preflight is the first executable statement after BEGIN", () => {
    const beginIndex = migration.indexOf("BEGIN;");
    const preflightIndex = migration.indexOf("DO $lifecycle_emails_migration_preflight$");
    const between = migration.slice(beginIndex + "BEGIN;".length, preflightIndex);
    const nonCommentLines = between
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(nonCommentLines).toEqual([]);
  });
});

describe("migration_lifecycle_emails.sql: preflight verifies real facts, not assumptions", () => {
  it("checks current_user, postgres.rolbypassrls, service_role existence, and auth.users.id type", () => {
    const preflightBody = migration.slice(
      migration.indexOf("DO $lifecycle_emails_migration_preflight$"),
      migration.indexOf("$lifecycle_emails_migration_preflight$;") + 1
    );
    expect(preflightBody).toMatch(/current_user\s*<>\s*'postgres'/);
    expect(preflightBody).toMatch(/rolbypassrls/);
    expect(preflightBody).toMatch(/rolname\s*=\s*'service_role'/);
    expect(preflightBody).toMatch(/nspname\s*=\s*'auth'\s*AND\s*c\.relname\s*=\s*'users'/);
  });

  it("fails loudly rather than silently proceeding if the table already exists", () => {
    const preflightBody = migration.slice(
      migration.indexOf("DO $lifecycle_emails_migration_preflight$"),
      migration.indexOf("$lifecycle_emails_migration_preflight$;") + 1
    );
    expect(preflightBody).toMatch(/v_table_exists\s+THEN/);
    expect(preflightBody).toMatch(/RAISE EXCEPTION 'Preflight failed: public\.lifecycle_emails already exists/);
  });
});

describe("migration_lifecycle_emails.sql: table shape", () => {
  it("creates exactly public.lifecycle_emails with the required columns", () => {
    expect(migration).toMatch(/CREATE TABLE public\.lifecycle_emails/);
    for (const column of [
      "id",
      "user_id",
      "email_type",
      "status",
      "eligible_at",
      "attempt_count",
      "last_attempt_at",
      "next_attempt_at",
      "locked_until",
      "claim_token",
      "sent_at",
      "provider_message_id",
      "last_error",
      "suppressed_at",
      "suppression_reason",
      "created_at",
      "updated_at",
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("user_id references auth.users(id) with ON DELETE CASCADE", () => {
    expect(migration).toMatch(/user_id\s+uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });

  it("constrains email_type to exactly the three lifecycle types", () => {
    expect(migration).toMatch(
      /CHECK \(email_type IN \('welcome', 'feedback_48h', 'checkin_7d'\)\)/
    );
  });

  it("constrains status to the explicit state model", () => {
    expect(migration).toMatch(
      /CHECK \(status IN \('pending', 'processing', 'sent', 'failed', 'suppressed', 'exhausted'\)\)/
    );
  });

  it("enforces UNIQUE(user_id, email_type)", () => {
    expect(migration).toMatch(/UNIQUE \(user_id, email_type\)/);
  });
});

describe("migration_lifecycle_emails.sql: security posture", () => {
  it("enables RLS but does not force it", () => {
    expect(migration).toMatch(/ALTER TABLE public\.lifecycle_emails ENABLE ROW LEVEL SECURITY;/);
    // Explanatory comments legitimately mention "FORCE ROW LEVEL SECURITY"
    // by name to document why it's deliberately not used — only the
    // executable SQL must never actually invoke it.
    expect(executableLines(migration)).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("creates zero policies on lifecycle_emails", () => {
    expect(migration).not.toMatch(/CREATE POLICY/);
  });

  it("explicitly revokes all table privileges from PUBLIC, anon, authenticated, AND service_role", () => {
    // service_role must be included in the REVOKE, not just PUBLIC/anon/
    // authenticated — Supabase grants service_role ALL PRIVILEGES on new
    // public-schema tables by default, so omitting it here would let that
    // default ALL (including DELETE) survive underneath the GRANT below.
    // This is the exact production bug the Step 1 dry run caught.
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.lifecycle_emails FROM PUBLIC, anon, authenticated, service_role;/
    );
  });

  it("grants only SELECT, INSERT, UPDATE to service_role — no DELETE, TRUNCATE, REFERENCES, or TRIGGER", () => {
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.lifecycle_emails TO service_role;/
    );
    const tableGrantLines = migration
      .split("\n")
      .filter((l) => /GRANT .* ON TABLE public\.lifecycle_emails/.test(l));
    for (const line of tableGrantLines) {
      expect(line).not.toMatch(/\bDELETE\b/);
      expect(line).not.toMatch(/\bTRUNCATE\b/);
      expect(line).not.toMatch(/\bREFERENCES\b/);
      expect(line).not.toMatch(/\bTRIGGER\b/);
    }
  });

  it("never grants anything to authenticated or anon on this table", () => {
    const tableGrantLines = migration
      .split("\n")
      .filter((l) => /GRANT .* ON TABLE public\.lifecycle_emails/.test(l));
    for (const line of tableGrantLines) {
      expect(line).not.toMatch(/\banon\b/);
      expect(line).not.toMatch(/\bauthenticated\b/);
    }
  });
});

describe("migration_lifecycle_emails.sql: functions follow the mandatory privilege convention", () => {
  it("claim_lifecycle_email and complete_lifecycle_email are both created, revoked from PUBLIC/anon/authenticated/service_role, and granted only to service_role", () => {
    for (const fn of ["claim_lifecycle_email", "complete_lifecycle_email"]) {
      expect(migration).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
  });

  it("both functions live in public, not flowtrack_private (PostgREST RPC reachability)", () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION flowtrack_private\./);
  });

  it("both functions set search_path = '' (SECURITY DEFINER convention)", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_lifecycle_email")
    );
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_lifecycle_email")
    );
    expect(claimBody).toMatch(/SECURITY DEFINER/);
    expect(claimBody).toMatch(/SET search_path = ''/);
    expect(completeBody).toMatch(/SECURITY DEFINER/);
    expect(completeBody).toMatch(/SET search_path = ''/);
  });
});

describe("migration_lifecycle_emails.sql: service_role DELETE privilege-leak fix (production dry-run finding)", () => {
  it("service_role is included in every REVOKE-before-GRANT normalization, not just PUBLIC/anon/authenticated", () => {
    const revokeLines = migration
      .split("\n")
      .filter((l) => /^REVOKE /.test(l.trim()));
    expect(revokeLines.length).toBeGreaterThan(0);
    for (const line of revokeLines) {
      expect(line).toMatch(/\bservice_role\b/);
    }
  });

  it("only the intended three table privileges are granted back to service_role", () => {
    const grantLines = migration
      .split("\n")
      .filter((l) => /^GRANT .* ON TABLE public\.lifecycle_emails/.test(l.trim()));
    expect(grantLines).toHaveLength(1);
    expect(grantLines[0]).toMatch(/^GRANT SELECT, INSERT, UPDATE ON TABLE public\.lifecycle_emails TO service_role;$/);
  });

  it("no table DELETE, TRUNCATE, REFERENCES, or TRIGGER grant exists anywhere in the migration", () => {
    const exec = executableLines(migration);
    expect(exec).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON TABLE public\.lifecycle_emails/);
    expect(exec).not.toMatch(/GRANT[^;]*\bTRUNCATE\b[^;]*ON TABLE public\.lifecycle_emails/);
    expect(exec).not.toMatch(/GRANT[^;]*\bREFERENCES\b[^;]*ON TABLE public\.lifecycle_emails/);
    expect(exec).not.toMatch(/GRANT[^;]*\bTRIGGER\b[^;]*ON TABLE public\.lifecycle_emails/);
  });

  it("documents the root cause (Supabase's default service_role ALL grant) in a comment near the fix", () => {
    const grantSection = migration.slice(
      migration.indexOf("REVOKE ALL ON TABLE public.lifecycle_emails"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_lifecycle_email")
    );
    expect(grantSection).toMatch(/platform-level default/i);
    expect(grantSection).toMatch(/ALL PRIVILEGES/);
    expect(grantSection).toMatch(/unexpectedly has DELETE/);
  });
});

describe("migration_lifecycle_emails.sql: claim_lifecycle_email is a single atomic statement", () => {
  it("claims via one UPDATE ... WHERE ... RETURNING, not a SELECT-then-UPDATE", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_lifecycle_email")
    );
    expect(claimBody).toMatch(/UPDATE public\.lifecycle_emails/);
    expect(claimBody).toMatch(/RETURNING/);
    // No separate SELECT ... FOR UPDATE step preceding the UPDATE — the
    // UPDATE's own WHERE clause is the entire atomicity mechanism.
    expect(claimBody).not.toMatch(/SELECT[^;]*FOR UPDATE/);
  });

  it("excludes terminal states and respects eligible_at, next_attempt_at, and the lease", () => {
    const claimBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.claim_lifecycle_email")
    );
    expect(claimBody).toMatch(/status NOT IN \('sent', 'exhausted', 'suppressed'\)/);
    expect(claimBody).toMatch(/eligible_at <= now\(\)/);
    expect(claimBody).toMatch(/next_attempt_at IS NULL OR le\.next_attempt_at <= now\(\)/);
    expect(claimBody).toMatch(/locked_until IS NULL OR le\.locked_until < now\(\)/);
  });
});

describe("migration_lifecycle_emails.sql: complete_lifecycle_email enforces claim-token ownership", () => {
  it("requires a matching claim_token and status = processing in its WHERE clause", () => {
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_lifecycle_email")
    );
    expect(completeBody).toMatch(/le\.claim_token = p_claim_token/);
    expect(completeBody).toMatch(/le\.status = 'processing'/);
    expect(completeBody).toMatch(/GET DIAGNOSTICS v_row_count = ROW_COUNT/);
    expect(completeBody).toMatch(/RETURN v_row_count > 0/);
  });

  it("only accepts sent, failed, or exhausted as a terminal status", () => {
    const completeBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_lifecycle_email"),
      migration.indexOf("REVOKE EXECUTE ON FUNCTION public.complete_lifecycle_email")
    );
    expect(completeBody).toMatch(/p_status NOT IN \('sent', 'failed', 'exhausted'\)/);
  });
});

describe("migration_lifecycle_emails.sql: never touches unrelated objects", () => {
  it("never modifies auth.users or auth.mfa_factors", () => {
    expect(migration).not.toMatch(/ALTER TABLE auth\.users/);
    expect(migration).not.toMatch(/ALTER TABLE auth\.mfa_factors/);
    expect(migration).not.toMatch(/UPDATE auth\.users/);
    expect(migration).not.toMatch(/INSERT INTO auth\.users/);
    expect(migration).not.toMatch(/DELETE FROM auth\.users/);
  });

  it("never touches a Phase 1C mfa_required_if_enrolled_* policy", () => {
    expect(migration).not.toMatch(/mfa_required_if_enrolled/);
  });

  it("never creates, alters, or grants anything in flowtrack_private — the header comment only explains why it's not used", () => {
    const exec = executableLines(migration);
    expect(exec).not.toMatch(/flowtrack_private/);
    expect(migration).toMatch(/flowtrack_private/); // the explanatory mention should still exist
  });
});

describe("lifecycle_emails_runbook.sql: structure", () => {
  it("contains Step 0 through Step 5 and the STOP-suppression appendix", () => {
    for (const marker of [
      "STEP 0: Baseline inventory",
      "STEP 1: Transactional dry run",
      "STEP 2: Real migration",
      "STEP 3: Post-migration verification",
      "STEP 4: Supervised disposable-account test",
      "STEP 5: Narrow rollback",
      "APPENDIX: Manual STOP suppression",
    ]) {
      expect(runbook).toContain(marker);
    }
  });

  it("Step 1's dry run has exactly one BEGIN and ends in ROLLBACK, not COMMIT", () => {
    const step1 = runbook.slice(
      runbook.indexOf("STEP 1: Transactional dry run"),
      runbook.indexOf("STEP 2: Real migration")
    );
    expect((step1.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect(step1).toMatch(/^ROLLBACK;$/m);
    expect(step1).not.toMatch(/^COMMIT;$/m);
  });

  it("uses set_config/current_setting GUCs for its before/after snapshot, never a temp table", () => {
    const step1 = runbook.slice(
      runbook.indexOf("STEP 1: Transactional dry run"),
      runbook.indexOf("STEP 2: Real migration")
    );
    expect(step1).toMatch(/set_config\(/);
    expect(step1).toMatch(/current_setting\(/);
    expect(executableLines(step1)).not.toMatch(/CREATE TEMP(ORARY)? TABLE/i);
    expect(step1).not.toMatch(/%ROWTYPE/);
  });

  it("never fabricates a fake auth.users row — the functional test reads an existing one or skips", () => {
    const functionalTest = runbook.slice(
      runbook.indexOf("$functional_claim_complete_test$"),
      runbook.lastIndexOf("$functional_claim_complete_test$;")
    );
    expect(functionalTest).toMatch(/SELECT id INTO v_user_id FROM auth\.users/);
    expect(functionalTest).toMatch(/IF v_user_id IS NULL THEN/);
    expect(functionalTest).toMatch(/RAISE NOTICE 'Skipped/);
    expect(functionalTest).not.toMatch(/INSERT INTO auth\.users/);
  });

  it("proves the FK rejects a nonexistent user_id using gen_random_uuid(), not a real id", () => {
    expect(runbook).toMatch(/INSERT INTO public\.lifecycle_emails \(user_id, email_type, eligible_at\)\s*\n\s*VALUES \(gen_random_uuid\(\), 'welcome', now\(\)\);/);
    expect(runbook).toMatch(/WHEN foreign_key_violation THEN/);
  });

  it("Step 5's narrow rollback drops only the three new objects", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5: Narrow rollback"),
      runbook.indexOf("APPENDIX")
    );
    expect(step5).toMatch(/DROP FUNCTION IF EXISTS public\.claim_lifecycle_email/);
    expect(step5).toMatch(/DROP FUNCTION IF EXISTS public\.complete_lifecycle_email/);
    expect(step5).toMatch(/DROP TABLE IF EXISTS public\.lifecycle_emails/);
    expect(step5).not.toMatch(/DROP.*auth\./);
    expect(step5).not.toMatch(/mfa_required_if_enrolled/);
  });

  it("the STOP suppression appendix requires a UUID, never a bare email match", () => {
    const appendix = runbook.slice(runbook.indexOf("APPENDIX: Manual STOP suppression"));
    expect(appendix).toMatch(/WHERE user_id = '<paste-the-verified-uuid-here>'/);
    expect(appendix).not.toMatch(/WHERE\s+email\s*=/i);
    expect(appendix).toMatch(/status NOT IN \('sent', 'suppressed'\)/);
  });
});

describe("lifecycle_emails_runbook.sql: Step 1 is a complete, standalone, correctly-ordered dry run", () => {
  function step1Text(): string {
    return runbook.slice(
      runbook.indexOf("STEP 1: Transactional dry run"),
      runbook.indexOf("STEP 2: Real migration")
    );
  }

  it("contains no placeholder or manual-splice instruction", () => {
    const step1 = step1Text();
    expect(step1.toLowerCase()).not.toMatch(/paste the full contents/);
    expect(step1.toLowerCase()).not.toMatch(/alberto: paste/);
    expect(step1.toLowerCase()).not.toMatch(/the real migration body, byte-for-byte identical/);
  });

  it("contains the real CREATE TABLE and both real CREATE FUNCTION statements", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/CREATE TABLE public\.lifecycle_emails \(/);
    expect(step1).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_lifecycle_email\(/);
    expect(step1).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_lifecycle_email\(/);
  });

  it("exactly one copy of every migration statement and exactly one preflight", () => {
    const step1 = step1Text();
    expect((step1.match(/DO \$lifecycle_emails_migration_preflight\$/g) ?? []).length).toBe(1);
    expect((step1.match(/CREATE TABLE public\.lifecycle_emails \(/g) ?? []).length).toBe(1);
    expect((step1.match(/CREATE OR REPLACE FUNCTION public\.claim_lifecycle_email\(/g) ?? []).length).toBe(1);
    expect((step1.match(/CREATE OR REPLACE FUNCTION public\.complete_lifecycle_email\(/g) ?? []).length).toBe(1);
  });

  it("the migration preflight is the first executable statement after Step 1's BEGIN", () => {
    const step1 = step1Text();
    const beginIndex = step1.indexOf("BEGIN;");
    const preflightIndex = step1.indexOf("DO $lifecycle_emails_migration_preflight$");
    const between = step1.slice(beginIndex + "BEGIN;".length, preflightIndex);
    const nonCommentLines = between
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(nonCommentLines).toEqual([]);
  });

  it("the GUC baseline snapshot runs after the preflight and before the migration body", () => {
    const step1 = step1Text();
    const preflightEnd = step1.indexOf("$lifecycle_emails_migration_preflight$;");
    const captureIndex = step1.indexOf("DO $capture_policies_before$");
    const tableIndex = step1.indexOf("CREATE TABLE public.lifecycle_emails");
    expect(preflightEnd).toBeGreaterThan(-1);
    expect(captureIndex).toBeGreaterThan(preflightEnd);
    expect(tableIndex).toBeGreaterThan(captureIndex);
  });

  it("Step 1's preflight is byte-for-byte identical to the migration's own preflight", () => {
    const step1 = step1Text();
    const migPreflightStart = migration.indexOf("BEGIN;") + "BEGIN;\n\n".length;
    const migPreflightEnd =
      migration.indexOf("$lifecycle_emails_migration_preflight$;") +
      "$lifecycle_emails_migration_preflight$;".length;
    const step1PreflightStart = step1.indexOf("BEGIN;") + "BEGIN;\n\n".length;
    const step1PreflightEnd =
      step1.indexOf("$lifecycle_emails_migration_preflight$;") +
      "$lifecycle_emails_migration_preflight$;".length;

    expect(step1.slice(step1PreflightStart, step1PreflightEnd)).toBe(
      migration.slice(migPreflightStart, migPreflightEnd)
    );
  });

  it("Step 1's post-snapshot migration body is byte-for-byte identical to the migration's own body after its preflight", () => {
    const step1 = step1Text();
    const startMarker =
      "-- ---------------------------------------------------------------------\n-- A. public.lifecycle_emails";
    const endMarker =
      "GRANT EXECUTE ON FUNCTION public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz) TO service_role;";

    const migStart = migration.indexOf(startMarker);
    const migEnd = migration.indexOf(endMarker) + endMarker.length;
    const step1Start = step1.indexOf(startMarker);
    const step1End = step1.indexOf(endMarker) + endMarker.length;

    expect(migStart).toBeGreaterThan(-1);
    expect(step1Start).toBeGreaterThan(-1);
    expect(step1.slice(step1Start, step1End)).toBe(migration.slice(migStart, migEnd));
  });

  it("actually exercises the UNIQUE(user_id, email_type) constraint and catches unique_violation", () => {
    const step1 = step1Text();
    const uniqueBlock = step1.slice(
      step1.indexOf("DO $assert_unique_constraint$"),
      step1.indexOf("$assert_unique_constraint$;") + "$assert_unique_constraint$;".length
    );
    expect(uniqueBlock).toMatch(/INSERT INTO public\.lifecycle_emails \(user_id, email_type, eligible_at\)/);
    expect((uniqueBlock.match(/VALUES \(v_user_id, 'feedback_48h', now\(\) \+ interval '1 day'\)/g) ?? []).length).toBe(2);
    expect(uniqueBlock).toMatch(/EXCEPTION WHEN unique_violation THEN/);
    expect(uniqueBlock).not.toMatch(/RAISE NOTICE[^;]*v_user_id/);
  });

  it("actually invokes both lifecycle RPCs under SET LOCAL ROLE service_role, not just a catalog privilege check", () => {
    const step1 = step1Text();
    const serviceRoleBlock = step1.slice(
      step1.indexOf("DO $assert_service_role_execution$"),
      step1.indexOf("$assert_service_role_execution$;") + "$assert_service_role_execution$;".length
    );
    expect(serviceRoleBlock).toMatch(/pg_has_role\(current_user, 'service_role', 'MEMBER'\)/);
    expect(serviceRoleBlock).toMatch(/SET LOCAL ROLE service_role;/);

    const setRoleIndex = serviceRoleBlock.indexOf("SET LOCAL ROLE service_role;");
    const claimCallIndex = serviceRoleBlock.indexOf("public.claim_lifecycle_email(v_row_id, 120)");
    const completeCallIndex = serviceRoleBlock.indexOf("public.complete_lifecycle_email(v_row_id, v_claim.claim_token");
    expect(claimCallIndex).toBeGreaterThan(setRoleIndex);
    expect(completeCallIndex).toBeGreaterThan(claimCallIndex);
  });

  it("RESET ROLE runs on both the success path and the exception path", () => {
    const step1 = step1Text();
    const serviceRoleBlock = step1.slice(
      step1.indexOf("DO $assert_service_role_execution$"),
      step1.indexOf("$assert_service_role_execution$;") + "$assert_service_role_execution$;".length
    );
    expect(serviceRoleBlock).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*RESET ROLE;\s*\n\s*RAISE;/);
    expect((serviceRoleBlock.match(/RESET ROLE;/g) ?? []).length).toBe(2);
  });

  it("keeps the catalog-level service_role privilege assertions as well", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/has_function_privilege\('service_role', 'public\.claim_lifecycle_email/);
    expect(step1).toMatch(/has_function_privilege\('service_role', 'public\.complete_lifecycle_email/);
  });

  it("the Step 1 migration body includes service_role in every REVOKE, matching the fixed migration", () => {
    const step1 = step1Text();
    expect(step1).toMatch(
      /REVOKE ALL ON TABLE public\.lifecycle_emails FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(step1).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_lifecycle_email\(uuid, integer\) FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(step1).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.complete_lifecycle_email\(uuid, uuid, text, text, text, timestamptz\) FROM PUBLIC, anon, authenticated, service_role;/
    );
  });

  it("$assert_grants$ checks all seven relevant table privilege types", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(grantsBlock).toMatch(new RegExp(`'${priv}'`));
    }
    expect(grantsBlock).toMatch(/v_forbidden_service_role_privs.*ARRAY\['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\]/);
  });

  it("$assert_grants$ checks PUBLIC's table and function privileges explicitly via the ACL catalog, not just named roles", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    expect(grantsBlock).toMatch(/aclexplode/);
    expect(grantsBlock).toMatch(/relacl/);
    expect(grantsBlock).toMatch(/proacl/);
    expect((grantsBlock.match(/acl\.grantee\s*=\s*0/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the PUBLIC table check reads from pg_class/pg_namespace via aclexplode using IF EXISTS, not a scalar SELECT INTO", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    expect(grantsBlock).toMatch(
      /IF EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM pg_class c\s*\n\s*JOIN pg_namespace n ON n\.oid = c\.relnamespace\s*\n\s*CROSS JOIN LATERAL\s*\n\s*aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\) AS acl\s*\n\s*WHERE n\.nspname = 'public'\s*\n\s*AND c\.relname = 'lifecycle_emails'\s*\n\s*AND c\.relkind = 'r'\s*\n\s*AND acl\.grantee = 0\s*\n\s*\) THEN/
    );
  });

  it("the PUBLIC function checks read from pg_proc/pg_namespace via aclexplode using IF EXISTS, and each matches an exact function signature via to_regprocedure", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    expect(grantsBlock).toMatch(/FROM pg_proc p\s*\n\s*JOIN pg_namespace n ON n\.oid = p\.pronamespace/);
    expect(grantsBlock).toMatch(/aclexplode\(COALESCE\(p\.proacl, acldefault\('f', p\.proowner\)\)\) AS acl/);
    // Exact-signature matching (not bare proname) for both functions —
    // to_regprocedure resolves schema + name + full argument-type list,
    // so an unrelated same-named overload could never be matched instead.
    expect(grantsBlock).toMatch(
      /p\.oid = to_regprocedure\('public\.claim_lifecycle_email\(uuid, integer\)'\)/
    );
    expect(grantsBlock).toMatch(
      /p\.oid = to_regprocedure\('public\.complete_lifecycle_email\(uuid, uuid, text, text, text, timestamptz\)'\)/
    );
    expect(grantsBlock).not.toMatch(/WHERE\s+p\.proname\s*=/);
  });

  it("the malformed v_public_*_acl_count SELECT-INTO construct is completely absent from the fixed assertion", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    // The only permitted mention is inside the explanatory comment
    // documenting the historical bug and its fix — never as a live
    // DECLAREd variable or a live SELECT ... INTO / IF <var> statement.
    expect(grantsBlock).not.toMatch(/DECLARE[\s\S]*v_public_table_acl_count/);
    expect(grantsBlock).not.toMatch(/SELECT count\(\*\) INTO v_public/);
    expect(grantsBlock).not.toMatch(/IF v_public_table_acl_count/);
    expect(grantsBlock).not.toMatch(/IF v_public_claim_acl_count/);
    expect(grantsBlock).not.toMatch(/IF v_public_complete_acl_count/);
  });

  it("no declared scalar plpgsql variable appears in a FROM or JOIN position anywhere in the runbook or Step 1", () => {
    // Regression guard for the exact bug class: a bare "v_..." identifier
    // (the naming convention this file's DECLARE blocks always use)
    // immediately after FROM or JOIN would mean a plpgsql scalar is being
    // parsed as a relation reference, which is exactly what produced
    // "relation \"v_public_table_acl_count\" does not exist" in production.
    expect(runbook).not.toMatch(/\b(FROM|JOIN)\s+v_[a-zA-Z_]*\b/);
    expect(step1Text()).not.toMatch(/\b(FROM|JOIN)\s+v_[a-zA-Z_]*\b/);
  });

  it("$assert_grants$ still asserts service_role has exactly SELECT/INSERT/UPDATE and lacks the other four", () => {
    const step1 = step1Text();
    const grantsBlock = step1.slice(
      step1.indexOf("DO $assert_grants$"),
      step1.indexOf("$assert_grants$;") + "$assert_grants$;".length
    );
    expect(grantsBlock).toMatch(/v_service_role_privs.*ARRAY\['SELECT', 'INSERT', 'UPDATE'\]/);
    expect(grantsBlock).toMatch(/service_role missing expected table privilege/);
    expect(grantsBlock).toMatch(/service_role unexpectedly has table privilege/);
  });

  it("preserves the documented single-session concurrency limitation", () => {
    const step1 = step1Text();
    expect(step1).toMatch(/single-session analogue of true concurrency/);
    expect(step1).toMatch(/not a genuine two-connection concurrency test/);
  });

  it("all five post-rollback verification results are present as separately named boolean columns", () => {
    const step1 = step1Text();
    const afterRollback = step1.slice(step1.indexOf("ROLLBACK;"));
    expect(afterRollback).toMatch(/AS lifecycle_emails_table_absent/);
    expect(afterRollback).toMatch(/AS claim_lifecycle_email_absent/);
    expect(afterRollback).toMatch(/AS complete_lifecycle_email_absent/);
    expect(afterRollback).toMatch(/AS public_table_count_matches_baseline_10/);
    expect(afterRollback).toMatch(/AS public_policy_count_matches_baseline_25/);
    expect(afterRollback).toMatch(/= 10\s*\n\s*AS public_table_count_matches_baseline_10/);
    expect(afterRollback).toMatch(/= 25\s*\n\s*AS public_policy_count_matches_baseline_25/);
  });

  it("still has exactly one BEGIN, one ROLLBACK, and zero COMMIT", () => {
    const step1 = step1Text();
    expect((step1.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((step1.match(/^ROLLBACK;$/gm) ?? []).length).toBe(1);
    expect(step1).not.toMatch(/^COMMIT;$/m);
  });

  it("never writes to auth.users, auth.mfa_factors, or any table other than public.lifecycle_emails", () => {
    const step1 = step1Text();
    expect(step1).not.toMatch(/INSERT INTO auth\./);
    expect(step1).not.toMatch(/UPDATE auth\./);
    expect(step1).not.toMatch(/DELETE FROM auth\./);
    expect(step1).not.toMatch(/mfa_required_if_enrolled/);

    const insertTargets = step1.match(/INSERT INTO (\S+)/g) ?? [];
    for (const target of insertTargets) {
      expect(target).toBe("INSERT INTO public.lifecycle_emails");
    }
  });

  it("contains no email, HTTP, webhook, or network operation", () => {
    const step1 = step1Text();
    // Checks for actual operations, not incidental comment mentions (e.g.
    // the migration's own copied comment about "cron/webhook route" naming
    // an unrelated existing route, or Resend's product name in prose).
    expect(step1).not.toMatch(/https?:\/\//i);
    expect(step1).not.toMatch(/\bresend\.(emails|com)\b/i);
    expect(step1).not.toMatch(/\b(pg_net|http_post|http_get|net\.http)\b/i);
    expect(step1).not.toMatch(/CREATE EXTENSION/i);
  });
});

describe("lifecycle_emails_runbook.sql: cron cadence documentation is resolved, not left as an open blocker", () => {
  it("records the Vercel Pro plan and the six-hour cadence", () => {
    expect(runbook).toMatch(/CRON CADENCE — RESOLVED/);
    expect(runbook).toMatch(/Vercel Pro/);
    expect(runbook).toMatch(/17 \*\/6 \* \* \*/);
    expect(runbook).toMatch(/every 6 hours|every six hours/i);
  });

  it("no longer claims the schedule is an open/unresolved decision", () => {
    expect(runbook).not.toMatch(/OPEN, UNRESOLVED rollout decision/);
    expect(runbook).not.toMatch(/NOT YET ADDED to vercel\.json/);
  });

  it("still states retries land comfortably within the 24-hour idempotency window, without claiming unconditional exactly-once delivery", () => {
    const cadenceSection = runbook.slice(
      runbook.indexOf("CRON CADENCE — RESOLVED"),
      runbook.indexOf("STEP 0:")
    );
    expect(cadenceSection).toMatch(/comfortably/);
    expect(cadenceSection).toMatch(/Resend's 24-hour idempotency-key window/);
    expect(cadenceSection).toMatch(/NOT an unconditional exactly-once guarantee/);
  });

  it("still names a genuine residual risk (missed invocations/outages), rather than declaring the risk fully closed", () => {
    const cadenceSection = runbook.slice(
      runbook.indexOf("CRON CADENCE — RESOLVED"),
      runbook.indexOf("STEP 0:")
    );
    expect(cadenceSection).toMatch(/\bmissed\b/i);
    expect(cadenceSection).toMatch(/cron invocation/i);
    expect(cadenceSection).toMatch(/outage/i);
  });
});

describe("vercel.json: signup-emails cron added alongside the unmodified Bill Guardian cron (and, later, launch-cohort-emails)", () => {
  const vercelJson = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf-8")
  ) as { crons: { path: string; schedule: string }[] };

  it("contains exactly three cron entries", () => {
    // bill-reminders (pre-existing) + signup-emails (this feature) +
    // launch-cohort-emails (lib/launch-cohort/ — see
    // migration_launch_cohort.test.ts for that cron's own assertions).
    expect(vercelJson.crons).toHaveLength(3);
  });

  it("preserves the existing Bill Guardian cron exactly (path and schedule unchanged)", () => {
    const billReminders = vercelJson.crons.find((c) => c.path === "/api/cron/bill-reminders");
    expect(billReminders).toBeDefined();
    expect(billReminders?.schedule).toBe("0 12 * * *");
  });

  it("adds the signup-emails cron with the exact requested six-hour schedule", () => {
    const signupEmails = vercelJson.crons.find((c) => c.path === "/api/cron/signup-emails");
    expect(signupEmails).toBeDefined();
    expect(signupEmails?.schedule).toBe("17 */6 * * *");
  });

  it("has no duplicate cron paths", () => {
    const paths = vercelJson.crons.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("signup-emails cron route: supports the HTTP method Vercel Cron uses", () => {
  const cronRouteSource = readFileSync(
    join(__dirname, "..", "..", "app", "api", "cron", "signup-emails", "route.ts"),
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
