import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "migration_privilege_hardening.sql"), "utf-8");
const runbook = readFileSync(join(__dirname, "privilege_hardening_runbook.sql"), "utf-8");
const convention = readFileSync(join(__dirname, "FUNCTION_PRIVILEGE_CONVENTION.md"), "utf-8");

describe("privilege hardening migration: transactional all-or-nothing structure", () => {
  it("wraps everything in exactly one BEGIN ... COMMIT pair", () => {
    const beginMatches = sql.match(/^\s*BEGIN;/gm) ?? [];
    const commitMatches = sql.match(/^\s*COMMIT;/gm) ?? [];
    expect(beginMatches.length).toBe(1);
    expect(commitMatches.length).toBe(1);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("COMMIT;"));
  });

  it("runs the preflight check before any privilege-changing statement", () => {
    const preflightIndex = sql.indexOf("$preflight$");
    const firstRevokeIndex = sql.indexOf("REVOKE TRUNCATE");
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(firstRevokeIndex);
  });

  it("preflight raises a clear exception rather than silently skipping", () => {
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/pg_has_role\(current_user, 'supabase_admin', 'MEMBER'\)/);
  });
});

describe("privilege hardening migration: existing-table privilege revocation", () => {
  it("revokes exactly TRUNCATE, REFERENCES, TRIGGER, MAINTAIN from anon and authenticated on all existing tables", () => {
    expect(sql).toMatch(
      /REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\n\s*ON ALL TABLES IN SCHEMA public\s*\n\s*FROM anon, authenticated;/
    );
  });

  it("never revokes SELECT, INSERT, UPDATE, or DELETE anywhere", () => {
    expect(sql).not.toMatch(/REVOKE[\s\S]{0,80}\b(SELECT|INSERT|UPDATE|DELETE)\b/);
  });

  it("never mentions service_role in any executable GRANT/REVOKE/ALTER statement", () => {
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/service_role/);
  });
});

describe("privilege hardening migration: future-table defaults for both owner roles", () => {
  for (const role of ["postgres", "supabase_admin"]) {
    it(`corrects future table defaults for role ${role}`, () => {
      const pattern = new RegExp(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA public\\s*\\n\\s*REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\\s*\\n\\s*ON TABLES FROM anon, authenticated;`
      );
      expect(sql).toMatch(pattern);
    });
  }
});

describe("privilege hardening migration: no unproven future-function default-privilege change", () => {
  it("contains no executable ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS statement (only discussed in comments)", () => {
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]*?ON FUNCTIONS/);
  });

  it("does not claim future functions are automatically made private by this migration", () => {
    // The migration's own comment must document that this was deliberately
    // excluded, not silently omitted or asserted as already handled.
    expect(sql).toMatch(/Deliberately NOT included/);
    expect(sql).toMatch(/has not yet proven/);
    expect(sql).toMatch(/empirically/);
  });

  it("points to the mandatory per-function convention doc and its enforcing test", () => {
    expect(sql).toContain("FUNCTION_PRIVILEGE_CONVENTION.md");
    expect(sql).toContain("function_privilege_convention.test.ts");
  });
});

describe("privilege hardening migration: handle_new_user hardening", () => {
  it("sets a fixed, empty search_path via ALTER FUNCTION rather than rewriting the body", () => {
    expect(sql).toContain("ALTER FUNCTION public.handle_new_user() SET search_path = '';");
  });

  it("never redefines the function body (no CREATE FUNCTION / CREATE OR REPLACE FUNCTION statement)", () => {
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it("revokes direct EXECUTE from PUBLIC, anon, and authenticated", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;"
    );
  });

  it("explicitly grants EXECUTE to supabase_auth_admin", () => {
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;");
  });

  it("never touches the trigger definition or reads/writes auth.users rows", () => {
    expect(sql).not.toMatch(/DROP TRIGGER/i);
    expect(sql).not.toMatch(/CREATE TRIGGER/i);
    expect(sql).not.toMatch(/(SELECT|INSERT INTO|UPDATE|DELETE FROM)\s+auth\.users/i);
  });
});

describe("privilege hardening migration: no destructive or data-mutating statements", () => {
  it("contains no DROP TABLE, DELETE, TRUNCATE execution, or ALTER COLUMN", () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(sql).not.toMatch(/^\s*TRUNCATE\s+(TABLE)?/im);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
  });

  it("contains no data UPDATE or backfill statement", () => {
    expect(sql).not.toMatch(/^\s*UPDATE\s+public\./im);
  });

  it("never drops or replaces an existing RLS policy", () => {
    expect(sql).not.toMatch(/DROP POLICY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("mandatory function-privilege convention document", () => {
  it("states the explicit REVOKE-then-GRANT requirement for every future public function", () => {
    expect(convention).toMatch(/REVOKE EXECUTE ON FUNCTION/);
    expect(convention).toMatch(/GRANT EXECUTE ON FUNCTION/);
    expect(convention).toContain("function_privilege_convention.test.ts");
  });
});

describe("privilege hardening runbook: contains every required stage", () => {
  it("has a read-only Step 0 baseline section, including the explicit-vs-inherited ACL check", () => {
    expect(runbook).toMatch(/STEP 0 — Read-only baseline/);
    expect(runbook).toContain("pg_policies");
    expect(runbook).toContain("pg_default_acl");
    expect(runbook).toContain("handle_new_user");
    expect(runbook).toContain("on_auth_user_created");
    expect(runbook).toContain("supabase_auth_admin_has_explicit_execute_grant");
    expect(runbook).toContain("public_has_execute_grant");
  });

  it("has a Step 1 transactional dry run using effective-privilege checks, ending in ROLLBACK", () => {
    expect(runbook).toMatch(/STEP 1 — Transactional dry run/);
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).toMatch(/BEGIN;/);
    expect(step1).toMatch(/ROLLBACK;/);
    expect(step1.indexOf("BEGIN;")).toBeLessThan(step1.indexOf("ROLLBACK;"));
    expect(step1).toContain("has_table_privilege(");
    expect(step1).toContain("has_function_privilege(");
    // Step 1 must not attempt the removed function-default statements.
    expect(step1).not.toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]*?ON FUNCTIONS/);
  });

  it("Step 2 instructs running the migration file separately rather than embedding it", () => {
    const step2 = runbook.slice(runbook.indexOf("STEP 2"), runbook.indexOf("STEP 3"));
    expect(step2).toContain("migration_privilege_hardening.sql");
    expect(step2).not.toMatch(/REVOKE TRUNCATE/);
  });

  it("has a Step 3 post-migration verification section using effective-privilege checks", () => {
    const step3 = runbook.slice(runbook.indexOf("STEP 3"), runbook.indexOf("STEP 4"));
    expect(step3).toMatch(/service_role/);
    expect(step3).toMatch(/pg_default_acl/);
    expect(step3).toMatch(/on_auth_user_created/);
    expect(step3).toContain("has_table_privilege(");
    expect(step3).toContain("has_function_privilege(");
  });

  it("has a Step 4 signup safety verification with expected results, stop conditions, and cleanup", () => {
    const step4 = runbook.slice(runbook.indexOf("STEP 4"), runbook.indexOf("STEP 5"));
    expect(step4).toMatch(/plan = 'free'/);
    expect(step4).toMatch(/Stop conditions/);
    expect(step4).toMatch(/Cleanup procedure/);
    expect(step4).not.toMatch(/^\s*INSERT INTO auth\.users/im);
  });

  it("Step 5 rollback restores only the exact ten baseline tables, not ALL TABLES IN SCHEMA public", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf("-- If the preflight check fails")
    );
    expect(step5).toMatch(/GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON/);
    expect(step5).not.toMatch(/GRANT[\s\S]*?ON ALL TABLES IN SCHEMA public/);
    for (const table of [
      "public.budgets",
      "public.budgets_backup",
      "public.categories",
      "public.categories_backup",
      "public.debts",
      "public.plan",
      "public.profiles",
      "public.transactions",
      "public.transactions_backup",
      "public.users",
    ]) {
      expect(step5).toContain(table);
    }
  });

  it("Step 5 does not attempt to restore the removed function-default statements", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf("-- If the preflight check fails")
    );
    expect(step5).not.toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]*?ON FUNCTIONS/);
  });

  it("Step 5 documents the explicit-vs-inherited distinction and does not claim byte-for-byte restoration", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf("-- If the preflight check fails")
    );
    expect(step5).toMatch(/does NOT claim byte-for-byte restoration/);
    expect(step5).toMatch(/supabase_auth_admin_has_explicit_execute_grant/);
  });

  it("Step 5 rollback restores search_path and grants, not data or RLS policies", () => {
    const step5 = runbook.slice(runbook.indexOf("STEP 5"));
    expect(step5).toMatch(/RESET search_path/);
    expect(step5).not.toMatch(/DROP POLICY/i);
    expect(step5).not.toMatch(/^\s*DELETE\s+FROM\s+public\./im);
  });

  it("has an optional Appendix proof procedure, clearly marked as not required and rollback-only", () => {
    expect(runbook).toMatch(/APPENDIX/);
    const appendix = runbook.slice(runbook.indexOf("APPENDIX"));
    expect(appendix).toMatch(/NOT required for Phase 1A/);
    expect(appendix).toMatch(/BEGIN;/);
    expect(appendix).toMatch(/ROLLBACK;/);
    expect(appendix.indexOf("BEGIN;")).toBeLessThan(appendix.indexOf("ROLLBACK;"));
    expect(appendix).not.toMatch(/\bCOMMIT;/);
  });
});
