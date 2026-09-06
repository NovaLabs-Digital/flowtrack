import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationSource = readFileSync(
  join(__dirname, "./migration_mfa_enforcement.sql"),
  "utf-8"
);
const runbookSource = readFileSync(
  join(__dirname, "./mfa_enforcement_runbook.sql"),
  "utf-8"
);

function executableStatements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const TARGET_TABLES = ["budgets", "categories", "debts", "profiles", "transactions", "users"];
const UNTOUCHED_TABLES = ["plan", "budgets_backup", "categories_backup", "transactions_backup"];

describe("migration_mfa_enforcement.sql: standalone from Phase 1A", () => {
  it("only mentions migration_privilege_hardening.sql in an explanatory comment, never executes/includes it", () => {
    const mentions = [...migrationSource.matchAll(/^.*migration_privilege_hardening\.sql.*$/gm)];
    expect(mentions.length).toBeGreaterThan(0);
    for (const [line] of mentions) {
      expect(line.trim().startsWith("--")).toBe(true);
    }
  });

  it("is wrapped in exactly one transaction", () => {
    expect(executableStatements(migrationSource).match(/\bBEGIN;/g)?.length).toBe(1);
    expect(executableStatements(migrationSource).match(/\bCOMMIT;/g)?.length).toBe(1);
  });
});

describe("migration_mfa_enforcement.sql: schema creation fails loudly on an unexpected owner", () => {
  it("checks the existing owner before creating, and RAISEs if it isn't postgres", () => {
    const block = migrationSource.slice(
      migrationSource.indexOf("$ensure_flowtrack_private_schema$"),
      migrationSource.lastIndexOf("$ensure_flowtrack_private_schema$")
    );
    expect(block).toMatch(/SELECT nspowner::regrole INTO existing_owner/);
    expect(block).toMatch(/IF existing_owner IS NULL THEN/);
    expect(block).toMatch(/CREATE SCHEMA flowtrack_private AUTHORIZATION postgres;/);
    expect(block).toMatch(/ELSIF existing_owner <> 'postgres'::regrole THEN/);
    expect(block).toMatch(/RAISE EXCEPTION/);
  });
});

describe("migration_mfa_enforcement.sql: schema privileges are minimal", () => {
  it("revokes all from PUBLIC/anon/authenticated, then grants only USAGE to authenticated", () => {
    expect(migrationSource).toContain(
      "REVOKE ALL ON SCHEMA flowtrack_private FROM PUBLIC, anon, authenticated;"
    );
    expect(migrationSource).toContain("GRANT USAGE ON SCHEMA flowtrack_private TO authenticated;");
  });

  it("never grants CREATE on flowtrack_private to anyone", () => {
    expect(executableStatements(migrationSource)).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA\s+flowtrack_private/i);
  });
});

describe("migration_mfa_enforcement.sql: mfa_access_allowed() shape", () => {
  const fnBody = migrationSource.slice(
    migrationSource.indexOf("CREATE OR REPLACE FUNCTION flowtrack_private.mfa_access_allowed()"),
    migrationSource.indexOf("REVOKE EXECUTE ON FUNCTION flowtrack_private.mfa_access_allowed()")
  );

  it("is zero-argument, STABLE, SECURITY DEFINER, with a fixed empty search_path", () => {
    expect(fnBody).toContain("mfa_access_allowed()");
    expect(fnBody).toContain("STABLE");
    expect(fnBody).toContain("SECURITY DEFINER");
    expect(fnBody).toContain("SET search_path = ''");
  });

  it("derives auth.uid() and auth.jwt()->>'aal' internally, never as parameters", () => {
    expect(fnBody).toContain("current_uid := auth.uid();");
    expect(fnBody).toContain("current_aal := auth.jwt() ->> 'aal';");
  });

  it("returns false for a missing uid, before any factor lookup", () => {
    const beforeLookup = fnBody.slice(0, fnBody.indexOf("SELECT EXISTS"));
    expect(beforeLookup).toMatch(/IF current_uid IS NULL THEN\s*RETURN false;/);
  });

  it("treats anything other than exactly aal1/aal2 as invalid, guarding against PL/pgSQL's NULL-as-false IF semantics", () => {
    expect(fnBody).toMatch(
      /is_valid_aal := current_aal IS NOT NULL AND current_aal IN \('aal1', 'aal2'\);/
    );
    expect(fnBody).toMatch(/IF NOT is_valid_aal THEN\s*RETURN false;/);
  });

  it("queries EXISTS against auth.mfa_factors scoped to the current uid, factor_type = 'totp', and status = 'verified' only", () => {
    expect(fnBody).toMatch(/SELECT EXISTS \(/);
    expect(fnBody).toContain("FROM auth.mfa_factors");
    expect(fnBody).toContain("WHERE auth.mfa_factors.user_id = current_uid");
    expect(fnBody).toContain("AND auth.mfa_factors.factor_type = 'totp'");
    expect(fnBody).toContain("AND auth.mfa_factors.status = 'verified'");
  });

  it("Phase 1C: a verified phone or WebAuthn factor structurally cannot satisfy the EXISTS check (factor_type is pinned to 'totp')", () => {
    // FlowTrack Phase 1B supports TOTP only. Production cannot have a fake
    // phone/webauthn row inserted to prove this at runtime (forbidden), so
    // this is a structural proof: the WHERE clause hardcodes 'totp', not a
    // variable or a broader IN (...) list, so no other factor_type value
    // can ever satisfy it regardless of status.
    expect(fnBody).not.toMatch(/factor_type\s+IN\s*\(/i);
    expect(fnBody).not.toMatch(/factor_type\s*=\s*'phone'/i);
    expect(fnBody).not.toMatch(/factor_type\s*=\s*'webauthn'/i);
  });

  it("returns exactly valid_aal AND (not enrolled OR aal = aal2), where 'enrolled' is has_verified_totp_factor", () => {
    expect(fnBody).toMatch(
      /RETURN is_valid_aal AND \(NOT has_verified_totp_factor OR current_aal = 'aal2'\);/
    );
  });

  it("never selects or exposes factor ids, secrets, rows, or counts — only a boolean", () => {
    const executableFnBody = executableStatements(fnBody);
    expect(executableFnBody).toMatch(/RETURNS boolean/);
    expect(executableFnBody).not.toContain("SELECT *");
    expect(executableFnBody).not.toMatch(/count\(/i);
    expect(executableFnBody).not.toMatch(/\bsecret\b/i);
    // auth.mfa_factors is touched by exactly one FROM clause (the single
    // EXISTS(...) subquery) — never a second, separate query against it.
    const fromMentions = executableFnBody.match(/FROM auth\.mfa_factors/g) ?? [];
    expect(fromMentions.length).toBe(1);
  });
});

describe("migration_mfa_enforcement.sql: function privilege narrowing", () => {
  it("revokes execute from PUBLIC/anon/authenticated, then grants only to authenticated", () => {
    expect(migrationSource).toContain(
      "REVOKE EXECUTE ON FUNCTION flowtrack_private.mfa_access_allowed() FROM PUBLIC, anon, authenticated;"
    );
    expect(migrationSource).toContain(
      "GRANT EXECUTE ON FUNCTION flowtrack_private.mfa_access_allowed() TO authenticated;"
    );
  });
});

describe("migration_mfa_enforcement.sql: restrictive policies", () => {
  for (const table of TARGET_TABLES) {
    it(`adds exactly one AS RESTRICTIVE, FOR ALL, TO authenticated policy to public.${table} calling the helper via SELECT`, () => {
      const policyName = `mfa_required_if_enrolled_${table}`;
      expect(migrationSource).toContain(`DROP POLICY IF EXISTS ${policyName} ON public.${table};`);

      const policyBlock = migrationSource.slice(
        migrationSource.indexOf(`CREATE POLICY ${policyName}`),
        migrationSource.indexOf(`CREATE POLICY ${policyName}`) + 400
      );
      expect(policyBlock).toContain(`ON public.${table}`);
      expect(policyBlock).toContain("AS RESTRICTIVE");
      expect(policyBlock).toContain("FOR ALL");
      expect(policyBlock).toContain("TO authenticated");
      expect(policyBlock).toMatch(/USING\s*\(\s*\(SELECT flowtrack_private\.mfa_access_allowed\(\)\)\s*\)/);
      expect(policyBlock).toMatch(/WITH CHECK\s*\(\s*\(SELECT flowtrack_private\.mfa_access_allowed\(\)\)\s*\)/);
    });
  }

  it("does not add any policy to plan or the three backup tables", () => {
    for (const table of UNTOUCHED_TABLES) {
      expect(migrationSource).not.toContain(`ON public.${table}`);
    }
  });

  it("never touches (DROP/ALTER/RENAME) any policy that isn't its own mfa_required_if_enrolled_* name", () => {
    const dropPolicyCalls = [...migrationSource.matchAll(/DROP POLICY[^\n]*/g)].map((m) => m[0]);
    for (const call of dropPolicyCalls) {
      expect(call).toMatch(/mfa_required_if_enrolled_/);
    }
    expect(executableStatements(migrationSource)).not.toMatch(/ALTER POLICY/i);
  });
});

describe("migration_mfa_enforcement.sql: repeatability", () => {
  it("uses CREATE OR REPLACE FUNCTION (safe to re-run) rather than a bare CREATE FUNCTION", () => {
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION flowtrack_private.mfa_access_allowed()");
    expect(migrationSource).not.toMatch(/(?<!OR REPLACE )CREATE FUNCTION flowtrack_private/);
  });

  it("uses DROP POLICY IF EXISTS before every CREATE POLICY it defines", () => {
    for (const table of TARGET_TABLES) {
      const policyName = `mfa_required_if_enrolled_${table}`;
      const dropIndex = migrationSource.indexOf(`DROP POLICY IF EXISTS ${policyName}`);
      const createIndex = migrationSource.indexOf(`CREATE POLICY ${policyName}`);
      expect(dropIndex).toBeGreaterThan(-1);
      expect(dropIndex).toBeLessThan(createIndex);
    }
  });
});

describe("mfa_enforcement_runbook.sql: contains every required stage", () => {
  it("has Steps 0 through 5", () => {
    expect(runbookSource).toMatch(/STEP 0/);
    expect(runbookSource).toMatch(/STEP 1/);
    expect(runbookSource).toMatch(/STEP 2/);
    expect(runbookSource).toMatch(/STEP 3/);
    expect(runbookSource).toMatch(/STEP 4/);
    expect(runbookSource).toMatch(/STEP 5/);
  });

  it("only mentions the Phase 1A runbook filename in explanatory comments, never executes/includes it", () => {
    const mentions = [...runbookSource.matchAll(/^.*privilege_hardening_runbook\.sql.*$/gm)];
    expect(mentions.length).toBeGreaterThan(0);
    for (const [line] of mentions) {
      expect(line.trim().startsWith("--")).toBe(true);
    }
  });
});

describe("mfa_enforcement_runbook.sql: Step 0h documents the verified enum labels", () => {
  const step0 = runbookSource.slice(runbookSource.indexOf("STEP 0"), runbookSource.indexOf("STEP 1"));

  it("adds a read-only query discovering the factor_type/status enum labels dynamically", () => {
    expect(step0).toMatch(/0h\./);
    expect(step0).toContain("FROM pg_attribute a");
    expect(step0).toContain("JOIN pg_enum e ON e.enumtypid = t.oid");
    expect(step0).toContain("AND a.attname IN ('factor_type', 'status')");
  });

  it("documents the verified production enum labels in a comment", () => {
    expect(step0).toMatch(/\{totp, webauthn, phone\}/);
    expect(step0).toMatch(/\{unverified,[\s-]*verified\}/);
  });

  it("states the TOTP-only enrollment rule, not 'any verified factor'", () => {
    expect(step0).toMatch(/factor_type = 'totp' AND status = 'verified'/);
    expect(step0).toMatch(/never "any verified[\s-]*factor"/);
  });
});

describe("mfa_enforcement_runbook.sql: the inline Step 1 function body matches migration_mfa_enforcement.sql", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("includes the same factor_type = 'totp' filter and renamed variable", () => {
    expect(step1).toContain("AND auth.mfa_factors.factor_type = 'totp'");
    expect(step1).toContain("has_verified_totp_factor");
    expect(step1).not.toMatch(/\bhas_verified_factor\b/);
  });
});

describe("mfa_enforcement_runbook.sql: Step 1 dry run is transactional and ends in ROLLBACK", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("contains exactly one BEGIN and ends with ROLLBACK, not COMMIT", () => {
    expect(executableStatements(step1).match(/\bBEGIN;/g)?.length).toBe(1);
    expect(step1).toMatch(/\nROLLBACK;\n/);
    const rollbackIndex = step1.indexOf("\nROLLBACK;\n");
    const laterCommit = step1.slice(rollbackIndex).match(/\bCOMMIT;/);
    expect(laterCommit).toBeNull();
  });

  it("never inserts any row into auth.mfa_factors", () => {
    expect(executableStatements(step1)).not.toMatch(/INSERT\s+INTO\s+auth\.mfa_factors/i);
  });

  it("contains the full migration body (schema guard, function, all six policies)", () => {
    expect(step1).toContain("$ensure_flowtrack_private_schema$");
    expect(step1).toContain("CREATE OR REPLACE FUNCTION flowtrack_private.mfa_access_allowed()");
    for (const table of TARGET_TABLES) {
      expect(step1).toContain(`mfa_required_if_enrolled_${table}`);
    }
  });
});

describe("Step 1: exact top-to-bottom ordering (final correction)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("BEGIN < preflight < first baseline capture < baseline assertion < ensure-schema block < privilege/function/policy changes < ROLLBACK < final status SELECT", () => {
    const beginIndex = step1.indexOf("\nBEGIN;\n");
    const preflightIndex = step1.indexOf("DO $mfa_migration_preflight$");
    const firstCaptureIndex = step1.indexOf("DO $capture_policies_before$");
    const baselineAssertionIndex = step1.indexOf("DO $assert_baseline_policy_count$");
    const ensureSchemaIndex = step1.indexOf("DO $ensure_flowtrack_private_schema$");
    const revokeGrantIndex = step1.indexOf("REVOKE ALL ON SCHEMA flowtrack_private");
    const createFunctionIndex = step1.indexOf("CREATE OR REPLACE FUNCTION flowtrack_private.mfa_access_allowed()");
    const firstPolicyIndex = step1.indexOf("DROP POLICY IF EXISTS mfa_required_if_enrolled_budgets");
    const rollbackIndex = step1.indexOf("\nROLLBACK;\n");
    const finalSelectIndex = step1.indexOf("SELECT\n  NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'flowtrack_private')");

    const indices = [
      beginIndex,
      preflightIndex,
      firstCaptureIndex,
      baselineAssertionIndex,
      ensureSchemaIndex,
      revokeGrantIndex,
      createFunctionIndex,
      firstPolicyIndex,
      rollbackIndex,
      finalSelectIndex,
    ];

    for (const i of indices) {
      expect(i).toBeGreaterThan(-1);
    }

    for (let i = 1; i < indices.length; i++) {
      expect(indices[i - 1]).toBeLessThan(indices[i]);
    }
  });

  it("the preflight is the very first executable statement after BEGIN; (only comments/whitespace between)", () => {
    const beginIndex = step1.indexOf("\nBEGIN;\n") + "\nBEGIN;\n".length;
    const preflightIndex = step1.indexOf("DO $mfa_migration_preflight$");
    const between = step1.slice(beginIndex, preflightIndex);
    const nonCommentLines = between
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(nonCommentLines).toEqual([]);
  });

  it("the preflight appears exactly once in the whole runbook", () => {
    const occurrences = runbookSource.match(/DO \$mfa_migration_preflight\$/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("Step 1: no static reference to a temp table created earlier in the same batch (production 42P01 fix)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("never creates a temp table at all — CREATE TEMP TABLE appears only in the explanatory comment describing the retired, buggy pattern", () => {
    const executableStep1 = executableStatements(step1);
    expect(executableStep1).not.toMatch(/CREATE\s+TEMP(?:ORARY)?\s+TABLE/i);
    // The comment documenting *why* this was removed is expected to still
    // name the retired pattern for future readers.
    expect(step1).toMatch(/CREATE TEMP TABLE \.\.\. AS SELECT/);
  });

  it("never declares a %ROWTYPE of any object created earlier in this same script", () => {
    expect(step1).not.toMatch(/%ROWTYPE/);
  });

  it("contains no bare identifier starting with the old _mfa_dry_run_ prefix anywhere (temp tables fully retired, not just renamed)", () => {
    expect(step1).not.toMatch(/_mfa_dry_run_/);
  });

  it("every baseline snapshot is passed between DO blocks via set_config()/current_setting() on a custom phase1c.* GUC, never a named relation", () => {
    const expectedGucKeys = [
      "phase1c.policies_before",
      "phase1c.tables_before",
      "phase1c.counts_before",
      "phase1c.hnu_functiondef",
      "phase1c.hnu_owner",
      "phase1c.hnu_secdef",
      "phase1c.hnu_config",
      "phase1c.hnu_acl",
      "phase1c.trg_def",
      "phase1c.trg_enabled",
      "phase1c.trg_relid",
      "phase1c.trg_foid",
      "phase1c.trg_type",
    ];
    for (const key of expectedGucKeys) {
      const setCount = (step1.match(new RegExp(`set_config\\('${key.replace(".", "\\.")}'`, "g")) ?? []).length;
      const getCount = (step1.match(new RegExp(`current_setting\\('${key.replace(".", "\\.")}'`, "g")) ?? []).length;
      expect(setCount).toBeGreaterThanOrEqual(1);
      expect(getCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("every set_config call for a phase1c.* snapshot GUC is transaction-local (is_local = true)", () => {
    const calls = [...step1.matchAll(/set_config\('phase1c\.[a-z_]+',\s*[^,]+,\s*(true|false)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, isLocal] of calls) {
      expect(isLocal).toBe("true");
    }
  });

  it("the multi-row snapshots (policies/tables/counts) use json_agg with an explicit ORDER BY, so the later text comparison is order-stable", () => {
    const captureBlock = step1.slice(
      step1.indexOf("DO $capture_policies_before$"),
      step1.indexOf("DO $capture_handle_new_user_before$")
    );
    const jsonAggCalls = [...captureBlock.matchAll(/json_agg\(row_to_json\(t\) ORDER BY [^)]+\)/g)];
    expect(jsonAggCalls.length).toBe(3);
  });
});

describe("mfa_enforcement_runbook.sql: Step 1 self-verifying assertions", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  const requiredAssertions = [
    "$assert_baseline_policy_count$",
    "$mfa_migration_preflight$",
    "$assert_existing_policies_unchanged$",
    "$assert_new_policies$",
    "$assert_backup_and_plan_untouched$",
    "$assert_schema_grants$",
    "$assert_function_execute$",
    "$assert_helper_shape$",
    "$assert_missing_uid$",
    "$assert_invalid_or_missing_aal$",
    "$assert_valid_aal1_no_factor_allowed$",
    "$assert_authenticated_execution_path$",
    "$assert_table_stats_unchanged$",
    "$assert_row_counts_unchanged$",
    "$assert_handle_new_user_intact$",
  ];

  it.each(requiredAssertions)("contains the %s assertion block with a RAISE EXCEPTION guard", (tag) => {
    expect(step1).toContain(tag);
    const start = step1.indexOf(tag);
    const nextTagCandidates = requiredAssertions
      .map((t) => step1.indexOf(t, start + tag.length))
      .filter((i) => i > -1);
    const end = nextTagCandidates.length > 0 ? Math.min(...nextTagCandidates) : step1.indexOf("ROLLBACK;", start);
    const block = step1.slice(start, end);
    expect(block).toMatch(/RAISE EXCEPTION/);
  });

  it("the missing-uid and invalid-aal assertions never insert a row into auth.mfa_factors", () => {
    const block = step1.slice(
      step1.indexOf("$assert_missing_uid$"),
      step1.indexOf("$assert_valid_aal1_no_factor_allowed$")
    );
    expect(block).not.toMatch(/INSERT/i);
  });

  it("uses set_config on request.jwt.claims to simulate identities, never RESET request.jwt.claims", () => {
    expect(step1).toMatch(/set_config\(\s*'request\.jwt\.claims'/);
    expect(step1).not.toMatch(/RESET request\.jwt\.claims/);
  });
});

describe("Step 1: no invalid top-level EXECUTE remains, and every JWT simulation is valid JSON (Requirements 1 & 2)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("contains no EXECUTE 'RESET ...' statement anywhere (the old invalid top-level form is gone entirely)", () => {
    expect(step1).not.toMatch(/EXECUTE\s+'RESET/);
  });

  it("the missing-uid assertion uses a valid empty JSON object via set_config, not RESET", () => {
    const block = step1.slice(
      step1.indexOf("DO $assert_missing_uid$"),
      step1.indexOf("$assert_missing_uid$;") + "$assert_missing_uid$;".length
    );
    expect(block).toContain("set_config('request.jwt.claims', '{}', true)");
    expect(block).not.toMatch(/RESET request\.jwt\.claims/);
  });

  it("the cleanup between the functional assertions and the table-stats assertions is a plain top-level SELECT set_config(...), not EXECUTE", () => {
    const cleanup = step1.slice(
      step1.indexOf("$assert_authenticated_execution_path$;") + "$assert_authenticated_execution_path$;".length,
      step1.indexOf("DO $assert_table_stats_unchanged$")
    );
    expect(cleanup).toContain("SELECT set_config('request.jwt.claims', '{}', true);");
    expect(executableStatements(cleanup)).not.toMatch(/EXECUTE/);
  });

  it("every request.jwt.claims value set is either the literal '{}' or a json_build_object(...) call — always valid JSON", () => {
    const setConfigCalls = [
      ...step1.matchAll(/set_config\(\s*'request\.jwt\.claims',\s*([^,]+),/g),
    ].map((m) => m[1].trim());
    expect(setConfigCalls.length).toBeGreaterThan(0);
    for (const value of setConfigCalls) {
      expect(value === "'{}'" || value.startsWith("json_build_object(")).toBe(true);
    }
  });
});

describe("Step 1: migration preflight is present and duplicated exactly (Requirement 3)", () => {
  function extractDoBlock(source: string, tag: string): string {
    const startTag = `DO $${tag}$`;
    const endTag = `$${tag}$;`;
    const start = source.indexOf(startTag);
    const end = source.indexOf(endTag, start) + endTag.length;
    return source.slice(start, end);
  }

  it("migration_mfa_enforcement.sql runs the preflight before CREATE SCHEMA/REVOKE/GRANT/DROP POLICY/CREATE POLICY", () => {
    const preflightIndex = migrationSource.indexOf("DO $mfa_migration_preflight$");
    expect(preflightIndex).toBeGreaterThan(-1);
    const preflightBlock = extractDoBlock(migrationSource, "mfa_migration_preflight");
    const afterPreflight = migrationSource.slice(preflightIndex + preflightBlock.length);
    expect(afterPreflight).toMatch(/CREATE SCHEMA flowtrack_private AUTHORIZATION postgres;/);
    expect(afterPreflight).toMatch(/REVOKE ALL ON SCHEMA flowtrack_private/);
    expect(afterPreflight).toMatch(/GRANT USAGE ON SCHEMA flowtrack_private/);
    expect(afterPreflight).toMatch(/DROP POLICY IF EXISTS mfa_required_if_enrolled_budgets/);
    expect(afterPreflight).toMatch(/CREATE POLICY mfa_required_if_enrolled_budgets/);
  });

  it("is byte-for-byte identical between migration_mfa_enforcement.sql and the Step 1 dry run", () => {
    const fromMigration = extractDoBlock(migrationSource, "mfa_migration_preflight");
    const step1 = runbookSource.slice(
      runbookSource.indexOf("STEP 1"),
      runbookSource.indexOf("STEP 2")
    );
    const fromStep1 = extractDoBlock(step1, "mfa_migration_preflight");
    expect(fromMigration.length).toBeGreaterThan(100);
    expect(fromStep1).toBe(fromMigration);
  });

  it("checks every required precondition", () => {
    const block = extractDoBlock(migrationSource, "mfa_migration_preflight");
    expect(block).toMatch(/IF current_user <> 'postgres' THEN/);
    expect(block).toMatch(/SELECT rolbypassrls INTO v_postgres_bypassrls FROM pg_roles WHERE rolname = 'postgres';/);
    expect(block).toMatch(/v_postgres_bypassrls IS NOT TRUE/);
    expect(block).toMatch(/has_schema_privilege\(current_user, 'auth', 'USAGE'\)/);
    expect(block).toMatch(/has_table_privilege\(current_user, 'auth\.mfa_factors', 'SELECT'\)/);
    expect(block).toMatch(/v_mfa_factors_relkind IS NULL/);
    expect(block).toMatch(/v_mfa_factors_relkind <> 'r'/);
    expect(block).toMatch(/unnest\(ARRAY\['user_id', 'factor_type', 'status'\]\)/);
    expect(block).toMatch(/FOREACH v_table IN ARRAY target_tables LOOP/);
    expect(block).toMatch(/v_table_owner <> 'postgres'::regrole/);
    expect(block).toMatch(/NOT v_table_rls_enabled/);
    expect(block).toMatch(/v_table_rls_forced THEN/);
    expect(block).toMatch(/v_flowtrack_private_owner IS NOT NULL AND v_flowtrack_private_owner <> 'postgres'::regrole/);
  });
});

describe("Step 1: authenticated-role functional assertion (Requirement 4)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );
  const block = step1.slice(
    step1.indexOf("DO $assert_authenticated_execution_path$"),
    step1.indexOf("$assert_authenticated_execution_path$;") + "$assert_authenticated_execution_path$;".length
  );

  it("first confirms pg_has_role membership before attempting SET ROLE", () => {
    expect(block).toMatch(/is_member := pg_has_role\(current_user, 'authenticated', 'MEMBER'\);/);
    const membershipCheckIndex = block.indexOf("pg_has_role(");
    const setRoleIndex = block.indexOf("SET LOCAL ROLE authenticated;");
    expect(membershipCheckIndex).toBeGreaterThan(-1);
    expect(membershipCheckIndex).toBeLessThan(setRoleIndex);
  });

  it("sets a transaction-local synthetic claim before switching role", () => {
    const setConfigIndex = block.indexOf("set_config(");
    const setRoleIndex = block.indexOf("SET LOCAL ROLE authenticated;");
    expect(setConfigIndex).toBeGreaterThan(-1);
    expect(setConfigIndex).toBeLessThan(setRoleIndex);
  });

  it("calls the helper as authenticated and resets the role on the success path", () => {
    expect(block).toContain("SET LOCAL ROLE authenticated;");
    expect(block).toContain("SELECT flowtrack_private.mfa_access_allowed() INTO result;");
    const successPath = block.slice(
      block.indexOf("SET LOCAL ROLE"),
      block.indexOf("EXCEPTION WHEN OTHERS")
    );
    expect(successPath).toContain("RESET ROLE;");
  });

  it("also resets the role inside the exception handler, then raises a specific exception (exception-safe)", () => {
    const exceptionHandler = block.slice(
      block.indexOf("EXCEPTION WHEN OTHERS"),
      block.indexOf("END;")
    );
    expect(exceptionHandler).toContain("RESET ROLE;");
    expect(exceptionHandler).toMatch(/RAISE EXCEPTION/);
  });

  it("asserts the aal1, no-factor synthetic identity returns true", () => {
    expect(block).toMatch(/json_build_object\('sub', fake_uid, 'aal', 'aal1'\)/);
    expect(block).toMatch(/IF result IS DISTINCT FROM true THEN/);
  });

  it("raises a specific exception if current_user is not a member of authenticated", () => {
    expect(block).toMatch(
      /RAISE EXCEPTION 'Preflight failed: current_user \(%\) is not a member of authenticated/
    );
  });

  it("uses a disposable synthetic uuid, distinct from the other assertions'", () => {
    expect(block).toContain("00000000-0000-0000-0000-000000000002");
  });
});

describe("Step 1: baseline is asserted to be exactly the expected 19 policies before creating anything (Requirement 5)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );
  const block = step1.slice(
    step1.indexOf("DO $assert_baseline_policy_count$"),
    step1.indexOf("$assert_baseline_policy_count$;") + "$assert_baseline_policy_count$;".length
  );

  it("runs after the preflight but before the ensure-schema/policy-creation part of the migration body resumes", () => {
    const preflightIndex = step1.indexOf("DO $mfa_migration_preflight$");
    const assertionIndex = step1.indexOf("$assert_baseline_policy_count$");
    const migrationBodyContinuedIndex = step1.indexOf("BEGIN migration body, continued");
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(assertionIndex).toBeGreaterThan(-1);
    expect(migrationBodyContinuedIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(assertionIndex);
    expect(assertionIndex).toBeLessThan(migrationBodyContinuedIndex);
  });

  it("checks the total count is exactly 19, not merely an unchanged-diff later", () => {
    expect(block).toMatch(/total_count <> 19/);
  });

  it("checks the exact per-table distribution (4/4/4/3/1/3)", () => {
    expect(block).toContain("('budgets', 4), ('categories', 4), ('debts', 4),");
    expect(block).toContain("('profiles', 3), ('transactions', 1), ('users', 3)");
  });
});

describe("Step 1: strengthened six-policy assertion checks qual/with_check content (Requirement 6)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );
  const block = step1.slice(
    step1.indexOf("DO $assert_new_policies$"),
    step1.indexOf("$assert_new_policies$;") + "$assert_new_policies$;".length
  );

  it("selects qual and with_check for each table's policy", () => {
    expect(block).toContain("SELECT qual, with_check INTO v_qual, v_with_check");
  });

  it("fails if qual or with_check is NULL", () => {
    expect(block).toMatch(/IF v_qual IS NULL THEN/);
    expect(block).toMatch(/IF v_with_check IS NULL THEN/);
  });

  it("fails unless both expressions reference flowtrack_private.mfa_access_allowed()", () => {
    expect(block).toMatch(/v_qual NOT LIKE '%flowtrack_private\.mfa_access_allowed%'/);
    expect(block).toMatch(/v_with_check NOT LIKE '%flowtrack_private\.mfa_access_allowed%'/);
  });
});

describe("Step 1: full signup-function/trigger baseline snapshot and comparison (Requirement 7)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );

  it("captures the 'before' snapshot via set_config (not a temp table), after the preflight but before the migration body resumes", () => {
    const preflightIndex = step1.indexOf("DO $mfa_migration_preflight$");
    const migrationBodyContinuedIndex = step1.indexOf("BEGIN migration body, continued");
    const captureFnIndex = step1.indexOf("DO $capture_handle_new_user_before$");
    const captureTriggerIndex = step1.indexOf("DO $capture_trigger_before$");
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(migrationBodyContinuedIndex).toBeGreaterThan(-1);
    expect(captureFnIndex).toBeGreaterThan(-1);
    expect(captureTriggerIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(captureFnIndex);
    expect(captureFnIndex).toBeLessThan(migrationBodyContinuedIndex);
    expect(captureTriggerIndex).toBeLessThan(migrationBodyContinuedIndex);
  });

  it("the before-capture reads pg_get_functiondef, owner, prosecdef, proconfig, and proacl, and stores each via set_config", () => {
    const snapshotBlock = step1.slice(
      step1.indexOf("DO $capture_handle_new_user_before$"),
      step1.indexOf("$capture_handle_new_user_before$;") + "$capture_handle_new_user_before$;".length
    );
    expect(snapshotBlock).toContain("pg_get_functiondef(p.oid), p.proowner::regrole::text, p.prosecdef, p.proconfig::text, p.proacl::text");
    expect(snapshotBlock).toContain("set_config('phase1c.hnu_functiondef', v_functiondef, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.hnu_owner', v_owner, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.hnu_secdef', v_secdef::text, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.hnu_config'");
    expect(snapshotBlock).toContain("set_config('phase1c.hnu_acl'");
  });

  it("the before-capture reads pg_get_triggerdef, tgenabled, tgrelid, tgfoid, and tgtype, and stores each via set_config", () => {
    const snapshotBlock = step1.slice(
      step1.indexOf("DO $capture_trigger_before$"),
      step1.indexOf("$capture_trigger_before$;") + "$capture_trigger_before$;".length
    );
    expect(snapshotBlock).toContain("pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgrelid::text, t.tgfoid::text, t.tgtype::text");
    expect(snapshotBlock).toContain("set_config('phase1c.trg_def', v_triggerdef, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.trg_enabled', v_tgenabled, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.trg_relid', v_tgrelid, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.trg_foid', v_tgfoid, true)");
    expect(snapshotBlock).toContain("set_config('phase1c.trg_type', v_tgtype, true)");
  });

  it("the assertion compares every captured field against its stored GUC after the migration body ran", () => {
    const block = step1.slice(
      step1.indexOf("DO $assert_handle_new_user_intact$"),
      step1.lastIndexOf("$assert_handle_new_user_intact$;")
    );
    expect(block).toMatch(/v_functiondef IS DISTINCT FROM current_setting\('phase1c\.hnu_functiondef', true\)/);
    expect(block).toMatch(/v_owner IS DISTINCT FROM current_setting\('phase1c\.hnu_owner', true\)/);
    expect(block).toMatch(/v_secdef::text IS DISTINCT FROM current_setting\('phase1c\.hnu_secdef', true\)/);
    expect(block).toMatch(/v_config, '__NULL__'\) IS DISTINCT FROM current_setting\('phase1c\.hnu_config', true\)/);
    expect(block).toMatch(/v_acl, '__NULL__'\) IS DISTINCT FROM current_setting\('phase1c\.hnu_acl', true\)/);
    expect(block).toMatch(/v_triggerdef IS DISTINCT FROM current_setting\('phase1c\.trg_def', true\)/);
    expect(block).toMatch(/v_tgenabled IS DISTINCT FROM current_setting\('phase1c\.trg_enabled', true\)/);
    expect(block).toMatch(/v_tgrelid IS DISTINCT FROM current_setting\('phase1c\.trg_relid', true\)/);
    expect(block).toMatch(/v_tgfoid IS DISTINCT FROM current_setting\('phase1c\.trg_foid', true\)/);
    expect(block).toMatch(/v_tgtype IS DISTINCT FROM current_setting\('phase1c\.trg_type', true\)/);
  });

  it("the assertion never declares or references a %ROWTYPE of a temp table", () => {
    const block = step1.slice(
      step1.indexOf("DO $assert_handle_new_user_intact$"),
      step1.lastIndexOf("$assert_handle_new_user_intact$;")
    );
    expect(block).not.toMatch(/%ROWTYPE/);
    expect(block).not.toMatch(/_mfa_dry_run_/);
  });
});

describe("Step 1: helper-shape assertion (Requirement 8)", () => {
  const step1 = runbookSource.slice(
    runbookSource.indexOf("STEP 1"),
    runbookSource.indexOf("STEP 2")
  );
  const block = step1.slice(
    step1.indexOf("DO $assert_helper_shape$"),
    step1.indexOf("$assert_helper_shape$;") + "$assert_helper_shape$;".length
  );

  it("checks owner = postgres", () => {
    expect(block).toMatch(/v_owner <> 'postgres'::regrole/);
  });

  it("checks provolatile for STABLE", () => {
    expect(block).toMatch(/v_volatile <> 's'/);
  });

  it("checks prosecdef for SECURITY DEFINER", () => {
    expect(block).toMatch(/NOT v_secdef THEN/);
  });

  it("checks pronargs = 0", () => {
    expect(block).toMatch(/v_nargs <> 0/);
  });

  it("checks the return type is boolean", () => {
    expect(block).toMatch(/v_rettype <> 'boolean'/);
  });

  it("checks the search_path is present and empty", () => {
    expect(block).toMatch(/v_search_path_entry IS NULL/);
    expect(block).toMatch(/v_search_path_value <> ''/);
  });
});

describe("mfa_enforcement_runbook.sql: Step 1 confirms complete rollback afterward", () => {
  it("the final status SELECT after ROLLBACK checks the schema, function, and policies are all gone", () => {
    const afterRollback = runbookSource.slice(
      runbookSource.indexOf("\nROLLBACK;\n", runbookSource.indexOf("STEP 1")),
      runbookSource.indexOf("STEP 2")
    );
    expect(afterRollback).toMatch(/schema_gone/);
    expect(afterRollback).toMatch(/function_gone/);
    expect(afterRollback).toMatch(/policies_gone/);
  });
});

describe("mfa_enforcement_runbook.sql: Step 5 narrow rollback", () => {
  const step5 = runbookSource.slice(runbookSource.indexOf("STEP 5"));

  it("drops exactly the six new policies, the helper function, and the schema", () => {
    for (const table of TARGET_TABLES) {
      expect(step5).toContain(`DROP POLICY IF EXISTS mfa_required_if_enrolled_${table} ON public.${table};`);
    }
    expect(step5).toContain("DROP FUNCTION IF EXISTS flowtrack_private.mfa_access_allowed();");
    expect(step5).toMatch(/DROP SCHEMA flowtrack_private;/);
  });

  it("never uses CASCADE anywhere in the rollback", () => {
    expect(executableStatements(step5)).not.toMatch(/CASCADE/i);
  });

  it("drops the schema without IF EXISTS, so an unexpected missing/non-empty schema fails loudly", () => {
    expect(step5).toMatch(/DROP SCHEMA flowtrack_private;/);
    expect(step5).not.toMatch(/DROP SCHEMA IF EXISTS flowtrack_private/);
  });

  it("is wrapped in its own transaction", () => {
    expect(executableStatements(step5).match(/\bBEGIN;/g)?.length).toBe(1);
    expect(executableStatements(step5).match(/\bCOMMIT;/g)?.length).toBe(1);
  });
});

describe("mfa_enforcement_runbook.sql: Step 0/0e never selects factor rows or ids", () => {
  it("the auth.mfa_factors baseline queries use only count/catalog metadata, never SELECT *", () => {
    const step0 = runbookSource.slice(runbookSource.indexOf("STEP 0"), runbookSource.indexOf("STEP 1"));
    expect(step0).not.toMatch(/SELECT\s+\*\s+FROM\s+auth\.mfa_factors/i);
    expect(step0).toMatch(/count\(\*\) AS mfa_factor_row_count FROM auth\.mfa_factors/);
  });
});
