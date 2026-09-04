import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "migration_privilege_hardening.sql"), "utf-8");
const runbook = readFileSync(join(__dirname, "privilege_hardening_runbook.sql"), "utf-8");
const convention = readFileSync(join(__dirname, "FUNCTION_PRIVILEGE_CONVENTION.md"), "utf-8");

const TEN_TABLES = [
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
];

function executableStatements(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const FOLLOW_UP_HEADING = "Supabase-managed follow-up — not executable by Alberto";

describe("privilege hardening migration: transactional all-or-nothing structure", () => {
  it("wraps everything in exactly one BEGIN ... COMMIT pair", () => {
    const beginMatches = sql.match(/^\s*BEGIN;/gm) ?? [];
    const commitMatches = sql.match(/^\s*COMMIT;/gm) ?? [];
    expect(beginMatches.length).toBe(1);
    expect(commitMatches.length).toBe(1);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("COMMIT;"));
  });

  it("contains no membership/superuser preflight (postgres owns every object this migration touches)", () => {
    expect(sql).not.toMatch(/\$preflight\$/);
    expect(sql).not.toMatch(/pg_has_role/);
    expect(sql).not.toMatch(/rolsuper/);
    expect(sql).not.toMatch(/RAISE EXCEPTION/);
  });
});

describe("privilege hardening migration: no supabase_admin statement anywhere", () => {
  it("contains no executable statement referencing supabase_admin", () => {
    const statements = executableStatements(sql);
    expect(statements).not.toMatch(/supabase_admin/);
  });

  it("does not claim Alberto/postgres can modify supabase_admin-owned defaults", () => {
    expect(sql).not.toMatch(/correct future-table defaults for objects created by (both )?postgres and supabase_admin/i);
  });

  it("documents (without executing) why supabase_admin is out of scope", () => {
    expect(sql).toMatch(/postgres is not a superuser and is not a member of supabase_admin/);
    expect(sql).toContain("Supabase-managed follow-up");
  });
});

describe("privilege hardening migration: existing postgres-owned table privilege revocation", () => {
  it("revokes exactly TRUNCATE, REFERENCES, TRIGGER, MAINTAIN from anon and authenticated, listing all ten exact tables", () => {
    const revokeBlock = sql.slice(sql.indexOf("REVOKE TRUNCATE"), sql.indexOf("FROM anon, authenticated;") + 30);
    for (const table of TEN_TABLES) {
      expect(revokeBlock).toContain(table);
    }
    expect(revokeBlock).toContain("TRUNCATE, REFERENCES, TRIGGER, MAINTAIN");
  });

  it("does not use ALL TABLES IN SCHEMA public for the existing-table revocation", () => {
    const statements = executableStatements(sql);
    expect(statements).not.toMatch(/ON ALL TABLES IN SCHEMA public/);
  });

  it("never revokes SELECT, INSERT, UPDATE, or DELETE anywhere", () => {
    expect(sql).not.toMatch(/REVOKE[\s\S]{0,200}\b(SELECT|INSERT|UPDATE|DELETE)\b/);
  });

  it("never mentions service_role in any executable statement", () => {
    const statements = executableStatements(sql);
    expect(statements).not.toMatch(/service_role/);
  });
});

describe("privilege hardening migration: future-table defaults for postgres only", () => {
  it("corrects future table defaults for postgres", () => {
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN\s*\n\s*ON TABLES FROM anon, authenticated;/
    );
  });

  it("contains exactly one ALTER DEFAULT PRIVILEGES statement in the executable migration", () => {
    const statements = executableStatements(sql);
    const matches = statements.match(/ALTER DEFAULT PRIVILEGES/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("privilege hardening migration: no unproven future-function default-privilege change", () => {
  it("contains no executable ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS statement", () => {
    const statements = executableStatements(sql);
    expect(statements).not.toMatch(/ON FUNCTIONS/);
  });

  it("does not claim future functions are automatically made private by this migration", () => {
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

  it("explicitly grants EXECUTE to supabase_auth_admin (this is a per-function grant, not a supabase_admin default-privilege statement)", () => {
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

  it("Step 1 has no supabase_admin membership preflight and no supabase_admin statements", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).not.toMatch(/\$preflight\$/);
    expect(step1).not.toMatch(/pg_has_role/);
    expect(step1).not.toMatch(/supabase_admin/);
  });

  it("Step 1 uses the exact 10-table list and ends in ROLLBACK", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).toMatch(/BEGIN;/);
    expect(step1).toMatch(/ROLLBACK;/);
    expect(step1.indexOf("BEGIN;")).toBeLessThan(step1.indexOf("ROLLBACK;"));
    for (const table of TEN_TABLES) {
      expect(step1).toContain(table);
    }
    expect(step1).not.toMatch(/ON ALL TABLES IN SCHEMA public/);
  });

  it("Step 1 verifies ordinary CRUD is unchanged and the four removed privileges are false", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).toContain("has_select");
    expect(step1).toContain("has_insert");
    expect(step1).toContain("has_update");
    expect(step1).toContain("has_delete");
    expect(step1).toContain("has_truncate");
    expect(step1).toContain("has_references");
    expect(step1).toContain("has_trigger");
    expect(step1).toContain("has_maintain");
  });

  it("Step 1 checks PUBLIC via ACL grantee = 0, never executes has_function_privilege('public', ...)", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(executableStatements(step1)).not.toMatch(/has_function_privilege\('public'/);
    expect(step1).toMatch(/grantee = 0/);
    expect(step1).toMatch(/acldefault\('f', p\.proowner\)/);
    expect(step1).toContain("has_function_privilege('anon'");
    expect(step1).toContain("has_function_privilege('authenticated'");
    expect(step1).toContain("has_function_privilege('supabase_auth_admin'");
  });

  it("Step 1's probe is created dynamically via EXECUTE, never as a standalone top-level CREATE TABLE statement", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).toContain("EXECUTE 'CREATE TABLE public.__flowtrack_privilege_probe (id bigint)';");
    // No bare, non-dynamic top-level CREATE TABLE for the probe anywhere in Step 1.
    expect(step1).not.toMatch(/^CREATE TABLE public\.__flowtrack_privilege_probe/m);
  });

  it("Step 1's probe creation happens after the future-table default correction it's testing", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1.indexOf("ALTER DEFAULT PRIVILEGES FOR ROLE postgres")).toBeLessThan(
      step1.indexOf("EXECUTE 'CREATE TABLE public.__flowtrack_privilege_probe")
    );
  });

  it("Step 1 resolves the probe's OID from pg_class/pg_namespace and fails explicitly unless exactly one is found", () => {
    const probeBlock = runbook.slice(
      runbook.indexOf("$assert_probe$"),
      runbook.indexOf("$assert_function_privileges$")
    );
    expect(probeBlock).toContain("FROM pg_class c");
    expect(probeBlock).toContain("JOIN pg_namespace n ON n.oid = c.relnamespace");
    expect(probeBlock).toContain("WHERE n.nspname = 'public' AND c.relname = '__flowtrack_privilege_probe'");
    expect(probeBlock).toMatch(/probe_count <> 1/);
    expect(probeBlock).toMatch(/RAISE EXCEPTION 'Expected exactly one public\.__flowtrack_privilege_probe relation/);
  });

  it("Step 1 checks probe privileges via the OID overload of has_table_privilege(), never by name", () => {
    const probeBlock = runbook.slice(
      runbook.indexOf("$assert_probe$"),
      runbook.indexOf("$assert_function_privileges$")
    );
    for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
      expect(probeBlock).toContain(`has_table_privilege(rl, probe_oid, '${priv}')`);
    }
    expect(probeBlock).not.toMatch(/has_table_privilege\([^)]*'public\.__flowtrack_privilege_probe'/);
  });

  it("no statement anywhere in Step 1 references the probe by name in has_table_privilege() (OID-only, per-role loop)", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).not.toMatch(/has_table_privilege\([^)]*'public\.__flowtrack_privilege_probe'/);
  });

  it("the probe table exists only inside Step 1 and is removed by ROLLBACK before the final status row", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    const createIndex = step1.indexOf("EXECUTE 'CREATE TABLE public.__flowtrack_privilege_probe");
    const rollbackIndex = step1.indexOf("ROLLBACK;");
    const regclassIndex = step1.indexOf("to_regclass('public.__flowtrack_privilege_probe')");
    expect(createIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(rollbackIndex);
    expect(regclassIndex).toBeGreaterThan(rollbackIndex);
    expect(step1).toMatch(/to_regclass\('public\.__flowtrack_privilege_probe'\) IS NULL AS probe_table_gone/);
  });

  it("the probe is scoped to Step 1 only — absent from Step 0, Step 3, Step 4, Step 5, the Supabase-managed follow-up, and the Appendix", () => {
    const step0 = runbook.slice(runbook.indexOf("STEP 0"), runbook.indexOf("STEP 1"));
    const step3 = runbook.slice(runbook.indexOf("STEP 3"), runbook.indexOf("STEP 4"));
    const step4 = runbook.slice(runbook.indexOf("STEP 4"), runbook.indexOf("STEP 5"));
    const step5 = runbook.slice(runbook.indexOf("STEP 5"), runbook.indexOf(FOLLOW_UP_HEADING));
    const followUp = runbook.slice(runbook.indexOf(FOLLOW_UP_HEADING), runbook.indexOf("APPENDIX"));
    const appendix = runbook.slice(runbook.indexOf("APPENDIX"));
    for (const section of [step0, step3, step4, step5, followUp, appendix]) {
      expect(section).not.toMatch(/__flowtrack_privilege_probe/);
    }
  });

  it("the probe is absent from the executable migration file entirely", () => {
    expect(sql).not.toMatch(/__flowtrack_privilege_probe/);
    expect(sql).not.toMatch(/privilege_probe/);
  });

  it("Step 1 confirms SECURITY DEFINER and the fixed empty search_path", () => {
    const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
    expect(step1).toContain("prosecdef AS security_definer");
    expect(step1).toContain("search_path = ''");
  });
});

describe("privilege hardening runbook: Step 1 self-verifying assertions (do not depend on visual inspection)", () => {
  const step1 = runbook.slice(runbook.indexOf("STEP 1"), runbook.indexOf("STEP 2"));
  const lastPrivilegeStatementIndex = step1.indexOf(
    "GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;"
  );
  const rollbackIndex = step1.indexOf("ROLLBACK;");
  const assertionsBlock = step1.slice(lastPrivilegeStatementIndex, rollbackIndex);

  const ASSERTION_TAGS = [
    "assert_existing_tables",
    "assert_probe",
    "assert_function_privileges",
    "assert_function_properties",
    "assert_trigger",
  ];

  it("declares one DO block per assertion category, each raising a specific exception on failure", () => {
    for (const tag of ASSERTION_TAGS) {
      expect(step1).toContain(`DO $${tag}$`);
      const block = step1.slice(step1.indexOf(`DO $${tag}$`), step1.indexOf(`$${tag}$;`) + tag.length + 2);
      expect(block).toMatch(/RAISE EXCEPTION/);
    }
  });

  it("every assertion DO block appears after the last privilege-changing statement and before ROLLBACK", () => {
    expect(lastPrivilegeStatementIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(lastPrivilegeStatementIndex);
    for (const tag of ASSERTION_TAGS) {
      const tagIndex = step1.indexOf(`DO $${tag}$`);
      expect(tagIndex).toBeGreaterThan(lastPrivilegeStatementIndex);
      expect(tagIndex).toBeLessThan(rollbackIndex);
    }
  });

  it("assertion 1+2: asserts all four CRUD privileges true and all four unsafe privileges false, for all ten tables and both roles", () => {
    const block = assertionsBlock.slice(
      assertionsBlock.indexOf("$assert_existing_tables$"),
      assertionsBlock.indexOf("$assert_probe$")
    );
    for (const table of [
      "budgets", "budgets_backup", "categories", "categories_backup",
      "debts", "plan", "profiles", "transactions", "transactions_backup", "users",
    ]) {
      expect(block).toContain(`'${table}'`);
    }
    expect(block).toContain("'anon', 'authenticated'");
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(block).toMatch(new RegExp(`NOT has_table_privilege\\(rl, 'public\\.' \\|\\| tbl, '${priv}'\\)`));
    }
    for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
      expect(block).toMatch(new RegExp(`has_table_privilege\\(rl, 'public\\.' \\|\\| tbl, '${priv}'\\)`));
    }
  });

  it("assertion 3: creates the probe dynamically, resolves its OID, and asserts it has none of the four unsafe privileges for either role", () => {
    const probeBlock = assertionsBlock.slice(
      assertionsBlock.indexOf("$assert_probe$"),
      assertionsBlock.indexOf("$assert_function_privileges$")
    );
    expect(probeBlock).toContain("EXECUTE 'CREATE TABLE public.__flowtrack_privilege_probe (id bigint)';");
    expect(probeBlock).toMatch(/probe_count <> 1/);
    for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
      expect(probeBlock).toContain(`has_table_privilege(rl, probe_oid, '${priv}')`);
    }
    expect(probeBlock).not.toMatch(/has_table_privilege\([^)]*'public\.__flowtrack_privilege_probe'/);
    expect(probeBlock).toMatch(/RAISE EXCEPTION 'Future-table default correction ineffective/);
  });

  it("assertion 4: checks PUBLIC via ACL grantee = 0 (never has_function_privilege('public', ...)), and anon/authenticated/supabase_auth_admin via has_function_privilege", () => {
    const fnPrivBlock = assertionsBlock.slice(
      assertionsBlock.indexOf("$assert_function_privileges$"),
      assertionsBlock.indexOf("$assert_function_properties$")
    );
    expect(fnPrivBlock).toMatch(/grantee = 0/);
    expect(executableStatements(fnPrivBlock)).not.toMatch(/has_function_privilege\('public'/);
    expect(fnPrivBlock).toContain("has_function_privilege('anon'");
    expect(fnPrivBlock).toContain("has_function_privilege('authenticated'");
    expect(fnPrivBlock).toMatch(/NOT has_function_privilege\('supabase_auth_admin'/);
  });

  it("assertion 5: checks exactly one function, owner postgres, SECURITY DEFINER, and parses search_path robustly rather than string-matching a fixed format", () => {
    const fnPropsBlock = assertionsBlock.slice(
      assertionsBlock.indexOf("$assert_function_properties$"),
      assertionsBlock.indexOf("$assert_trigger$")
    );
    expect(fnPropsBlock).toMatch(/fn_count <> 1/);
    expect(fnPropsBlock).toMatch(/fn_owner <> 'postgres'/);
    expect(fnPropsBlock).toMatch(/NOT fn_secdef/);
    // Robust parsing: extracts the value after '=' and strips quotes, rather
    // than matching a single hardcoded literal like "search_path=" or
    // "search_path=\"\"".
    expect(fnPropsBlock).toContain("cfg LIKE 'search_path=%'");
    expect(fnPropsBlock).toContain('btrim(substring(cfg FROM position(\'=\' IN cfg) + 1), \'"\')');
    expect(fnPropsBlock).toMatch(/search_path_value <> ''/);
  });

  it("assertion 6: checks the trigger via catalog fields/bit flags, not by string-matching pg_get_triggerdef()", () => {
    const block = assertionsBlock.slice(assertionsBlock.indexOf("$assert_trigger$"));
    expect(block).toContain("trg_count <> 1");
    expect(block).toContain("trg.tgenabled <> 'O'");
    expect(block).toContain("trg.tgrelid <> 'auth.users'::regclass");
    expect(block).toContain("trg.tgfoid <> 'public.handle_new_user()'::regprocedure");
    // Bit flags per Postgres's documented tgtype layout, not text parsing.
    // Proves exactly: row-level, AFTER, INSERT, and not BEFORE/INSTEAD OF/
    // DELETE/UPDATE/TRUNCATE.
    expect(block).toContain("(trg.tgtype & 1) = 0");   // row-level required
    expect(block).toContain("(trg.tgtype & 2) <> 0");  // not BEFORE
    expect(block).toContain("(trg.tgtype & 64) <> 0"); // not INSTEAD OF
    expect(block).toContain("(trg.tgtype & 4) = 0");   // INSERT required
    expect(block).toContain("(trg.tgtype & 8) <> 0");  // not DELETE
    expect(block).toContain("(trg.tgtype & 16) <> 0"); // not UPDATE
    expect(block).toContain("(trg.tgtype & 32) <> 0"); // not TRUNCATE
    expect(executableStatements(block)).not.toMatch(/pg_get_triggerdef/);
  });

  it("assertion 6 raises a distinct, specific exception message for each unexpected event bit", () => {
    const block = assertionsBlock.slice(assertionsBlock.indexOf("$assert_trigger$"));
    expect(block).toMatch(/RAISE EXCEPTION 'on_auth_user_created unexpectedly also fires on DELETE/);
    expect(block).toMatch(/RAISE EXCEPTION 'on_auth_user_created unexpectedly also fires on UPDATE/);
    expect(block).toMatch(/RAISE EXCEPTION 'on_auth_user_created unexpectedly also fires on TRUNCATE/);
  });

  it("keeps the ROLLBACK, and returns a final compact status row with dry_run_completed and probe_table_gone", () => {
    expect(step1).toMatch(/ROLLBACK;/);
    const afterRollback = step1.slice(step1.indexOf("ROLLBACK;"));
    expect(afterRollback).toMatch(/true AS dry_run_completed/);
    expect(afterRollback).toMatch(/to_regclass\('public\.__flowtrack_privilege_probe'\) IS NULL AS probe_table_gone/);
  });

  it("does not remove the existing human-readable SELECT queries, but they are no longer load-bearing", () => {
    expect(step1).toContain("Verify EFFECTIVE table privileges WHILE STILL INSIDE the transaction");
    expect(step1).toMatch(/not load-bearing/);
  });

  it("nowhere in the runbook is has_function_privilege('public', ...) actually executed (only discussed in comments)", () => {
    expect(executableStatements(runbook)).not.toMatch(/has_function_privilege\('public'/);
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
    expect(step3).toMatch(/grantee = 0/);
    expect(executableStatements(step3)).not.toMatch(/has_function_privilege\('public'/);
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
      runbook.indexOf(FOLLOW_UP_HEADING)
    );
    expect(step5).toMatch(/GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON/);
    expect(step5).not.toMatch(/GRANT[\s\S]*?ON ALL TABLES IN SCHEMA public/);
    for (const table of TEN_TABLES) {
      expect(step5).toContain(table);
    }
  });

  it("Step 5 contains no executable supabase_admin restore statement", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf(FOLLOW_UP_HEADING)
    );
    expect(executableStatements(step5)).not.toMatch(/supabase_admin/);
  });

  it("Step 5 documents the explicit-vs-inherited distinction and does not claim byte-for-byte restoration", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf(FOLLOW_UP_HEADING)
    );
    expect(step5).toMatch(/does NOT claim byte-for-byte restoration/);
    expect(step5).toMatch(/supabase_auth_admin_has_explicit_execute_grant/);
  });

  it("Step 5 rollback restores search_path and grants, not data or RLS policies", () => {
    const step5 = runbook.slice(
      runbook.indexOf("STEP 5"),
      runbook.indexOf(FOLLOW_UP_HEADING)
    );
    expect(step5).toMatch(/RESET search_path/);
    expect(step5).not.toMatch(/DROP POLICY/i);
    expect(step5).not.toMatch(/^\s*DELETE\s+FROM\s+public\./im);
  });

  it("has a 'Supabase-managed follow-up — not executable by Alberto' section that is documentation only", () => {
    expect(runbook).toContain("Supabase-managed follow-up — not executable by Alberto");
    const followUp = runbook.slice(
      runbook.indexOf(FOLLOW_UP_HEADING),
      runbook.indexOf("APPENDIX")
    );
    // The supabase_admin statement appears here only as a commented example,
    // never as something this runbook or the migration actually executes.
    const executableLines = followUp
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0);
    expect(executableLines.join("\n")).not.toMatch(/ALTER DEFAULT PRIVILEGES/);
    expect(followUp).toMatch(/must be requested through Supabase/);
    expect(followUp).toMatch(/Support or another Supabase-authorized managed-role process/);
    // Must explicitly prohibit granting role membership as a workaround, not instruct it.
    expect(followUp).toMatch(/not by granting postgres membership in supabase_admin/i);
    expect(followUp).toMatch(/not run by\s*\n?\s*-- Alberto/);
  });

  it("has an optional Appendix proof procedure, clearly marked as not required and rollback-only", () => {
    expect(runbook).toMatch(/APPENDIX/);
    const appendix = runbook.slice(runbook.indexOf("APPENDIX"));
    expect(appendix).toMatch(/NOT required for Phase 1A/);
    expect(appendix).toMatch(/BEGIN;/);
    expect(appendix).toMatch(/ROLLBACK;/);
    expect(appendix.indexOf("BEGIN;")).toBeLessThan(appendix.indexOf("ROLLBACK;"));
    expect(appendix).not.toMatch(/\bCOMMIT;/);
    expect(executableStatements(appendix)).not.toMatch(/has_function_privilege\('public'/);
  });
});

describe("no SQL file in lib/security is executed automatically by build or deploy", () => {
  it("package.json's build/dev/start scripts never reference a .sql file", () => {
    const packageJson = readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8");
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;
    for (const script of Object.values(scripts)) {
      expect(script).not.toMatch(/\.sql/);
    }
  });

  it("vercel.json declares only the pre-existing cron route, nothing that runs SQL", () => {
    const vercelJson = readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf-8");
    expect(vercelJson).not.toMatch(/\.sql/);
    expect(vercelJson).not.toMatch(/migration/i);
  });

  it("no application route file imports or requires either committed SQL file", () => {
    // These files are inert repository content; the only intended reader is
    // a human pasting them into the Supabase SQL Editor. Every API route in
    // the app is a plausible place code could accidentally wire one in.
    const routeFiles = [
      "app/api/cron/bill-reminders/route.ts",
      "app/api/stripe/checkout/route.ts",
      "app/api/stripe/portal/route.ts",
      "app/api/stripe/webhook/route.ts",
      "app/api/support/route.ts",
      "app/api/test-email/route.ts",
      "app/api/email-preview/route.ts",
    ];
    for (const relPath of routeFiles) {
      const source = readFileSync(join(__dirname, "..", "..", relPath), "utf-8");
      expect(source).not.toMatch(/migration_privilege_hardening\.sql/);
      expect(source).not.toMatch(/privilege_hardening_runbook\.sql/);
    }
  });
});
