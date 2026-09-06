-- FlowTrack: Optional-MFA restrictive RLS enforcement — Runbook (Security
-- Phase 1C). Companion to lib/security/migration_mfa_enforcement.sql.
-- Run each numbered step independently, one at a time, in the Supabase SQL
-- Editor, and report the result of each back before proceeding to the next.
--
-- This runbook does not modify or reapply lib/security/
-- privilege_hardening_runbook.sql (Phase 1A) or migration_privilege_
-- hardening.sql. It is entirely self-contained for Phase 1C.

-- =======================================================================
-- STEP 0 — read-only baseline. No writes. Run 0a through 0h in order.
-- =======================================================================

-- 0a. Row counts for all ten FlowTrack tables (compare against Step 3).
SELECT 'budgets' AS table_name, count(*) AS row_count FROM public.budgets
UNION ALL SELECT 'budgets_backup', count(*) FROM public.budgets_backup
UNION ALL SELECT 'categories', count(*) FROM public.categories
UNION ALL SELECT 'categories_backup', count(*) FROM public.categories_backup
UNION ALL SELECT 'debts', count(*) FROM public.debts
UNION ALL SELECT 'plan', count(*) FROM public.plan
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'transactions', count(*) FROM public.transactions
UNION ALL SELECT 'transactions_backup', count(*) FROM public.transactions_backup
UNION ALL SELECT 'users', count(*) FROM public.users;

-- 0b. Owner, RLS, and FORCE RLS flags for all ten tables (compare against
-- Step 3 — none of these should change).
SELECT relname AS table_name, relowner::regrole AS owner,
       relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- 0c. Full pg_policies snapshot — should show exactly the 19 Phase 1A
-- policies, and no policy named mfa_required_if_enrolled_*.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 0d. Confirm flowtrack_private does not already exist under an unexpected
-- owner (production fact as reported: it does not exist at all yet).
SELECT nspname AS schema_name, nspowner::regrole AS owner
FROM pg_namespace
WHERE nspname = 'flowtrack_private';

-- 0e. auth.mfa_factors — full fact sheet (re-confirms the verified
-- production facts this migration is scoped to; never selects factor rows
-- or ids, only aggregate/catalog metadata).
SELECT
  c.relname             AS relation_name,
  n.nspname             AS schema_name,
  c.relkind             AS relkind,
  c.relowner::regrole   AS owner,
  c.relrowsecurity      AS relrowsecurity,
  c.relforcerowsecurity AS relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND c.relname = 'mfa_factors';

SELECT
  current_user AS current_user_name,
  (SELECT rolsuper     FROM pg_roles WHERE rolname = 'postgres') AS postgres_rolsuper,
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres') AS postgres_rolbypassrls,
  has_schema_privilege('postgres', 'auth', 'USAGE')              AS postgres_has_auth_usage,
  has_table_privilege('postgres', 'auth.mfa_factors', 'SELECT')  AS postgres_has_mfa_factors_select;

SELECT
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class c
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE c.relnamespace = 'auth'::regnamespace AND c.relname = 'mfa_factors'
ORDER BY grantee, acl.privilege_type;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'auth' AND tablename = 'mfa_factors';

SELECT column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'auth' AND table_name = 'mfa_factors'
ORDER BY ordinal_position;

-- 0f. handle_new_user()/on_auth_user_created remain exactly as Phase 1A
-- left them (same queries as privilege_hardening_runbook.sql Step 0f/0g).
SELECT
  p.proname AS function_name,
  p.proowner::regrole AS owner,
  p.prosecdef AS is_security_definer,
  p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

SELECT pg_get_triggerdef(t.oid) AS trigger_definition, t.tgenabled, t.tgtype
FROM pg_trigger t
WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;

-- 0g. Confirm production currently has zero MFA factors (aggregate count
-- only — no rows or ids). This is the verified fact Step 1's functional
-- assertions rely on instead of inserting any synthetic row.
SELECT count(*) AS mfa_factor_row_count FROM auth.mfa_factors;

-- 0h. auth.mfa_factors enum labels for factor_type and status. Discovers
-- whichever enum type backs each column dynamically (never hardcodes a
-- guessed type name) and lists its labels in definition order. Verified
-- production values (confirmed by Alberto, not assumed): factor_type has
-- exactly {totp, webauthn, phone}; status has exactly {unverified,
-- verified}. FlowTrack Phase 1B supports TOTP only, which is why every
-- enrollment check in this project (SQL, server, and client) is defined as
-- factor_type = 'totp' AND status = 'verified' — never "any verified
-- factor" — a verified phone or webauthn factor must not count.
SELECT
  a.attname AS column_name,
  t.typname AS enum_type_name,
  e.enumlabel AS enum_label,
  e.enumsortorder
FROM pg_attribute a
JOIN pg_type t ON t.oid = a.atttypid
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND c.relname = 'mfa_factors'
  AND a.attname IN ('factor_type', 'status')
ORDER BY a.attname, e.enumsortorder;

-- =======================================================================
-- STEP 1 — complete transactional dry run. Captures baselines, asserts the
-- baseline itself is exactly as expected, applies the full migration body
-- inline (including its preflight), self-verifies with RAISE EXCEPTION
-- assertions — including exercising the helper as the real authenticated
-- role, not merely as its postgres owner — then ROLLBACKs unconditionally.
-- No lasting change regardless of outcome. Does NOT insert any row into
-- auth.mfa_factors, ever. Every request.jwt.claims simulation uses
-- set_config(..., true) with valid JSON (never RESET, never a bare
-- top-level EXECUTE) so auth.jwt() always receives well-formed input.
-- =======================================================================

BEGIN;

-- ===================== BEGIN migration body: preflight (identical to =========
-- ===================== lib/security/migration_mfa_enforcement.sql) ===========
-- 0. Preflight (Requirement 3): fail loudly, before touching anything —
-- including before this dry run's own baseline captures below — unless
-- every verified production fact this migration depends on is still true.
-- This is the very first executable statement after BEGIN;, matching its
-- position as the first statement in migration_mfa_enforcement.sql.
DO $mfa_migration_preflight$
DECLARE
  v_postgres_bypassrls      boolean;
  v_auth_usage              boolean;
  v_mfa_factors_select      boolean;
  v_mfa_factors_relkind     "char";
  v_missing_columns         text;
  v_table                   text;
  v_table_owner             regrole;
  v_table_rls_enabled       boolean;
  v_table_rls_forced        boolean;
  v_flowtrack_private_owner regrole;
  target_tables text[] := ARRAY['budgets','categories','debts','profiles','transactions','users'];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Preflight failed: current_user is % (expected postgres)', current_user;
  END IF;

  SELECT rolbypassrls INTO v_postgres_bypassrls FROM pg_roles WHERE rolname = 'postgres';
  IF v_postgres_bypassrls IS NOT TRUE THEN
    RAISE EXCEPTION 'Preflight failed: postgres.rolbypassrls is not true (got %)', v_postgres_bypassrls;
  END IF;

  v_auth_usage := has_schema_privilege(current_user, 'auth', 'USAGE');
  IF NOT v_auth_usage THEN
    RAISE EXCEPTION 'Preflight failed: current_user lacks USAGE on schema auth';
  END IF;

  v_mfa_factors_select := has_table_privilege(current_user, 'auth.mfa_factors', 'SELECT');
  IF NOT v_mfa_factors_select THEN
    RAISE EXCEPTION 'Preflight failed: current_user lacks SELECT on auth.mfa_factors';
  END IF;

  SELECT c.relkind INTO v_mfa_factors_relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'mfa_factors';

  IF v_mfa_factors_relkind IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: auth.mfa_factors does not exist';
  ELSIF v_mfa_factors_relkind <> 'r' THEN
    RAISE EXCEPTION 'Preflight failed: auth.mfa_factors is not an ordinary table (relkind = %)', v_mfa_factors_relkind;
  END IF;

  SELECT string_agg(missing_col, ', ') INTO v_missing_columns
  FROM unnest(ARRAY['user_id', 'factor_type', 'status']) AS missing_col
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'mfa_factors' AND column_name = missing_col
  );
  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed: auth.mfa_factors is missing expected column(s): %', v_missing_columns;
  END IF;

  FOREACH v_table IN ARRAY target_tables LOOP
    SELECT c.relowner::regrole, c.relrowsecurity, c.relforcerowsecurity
    INTO v_table_owner, v_table_rls_enabled, v_table_rls_forced
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname = v_table AND c.relkind = 'r';

    IF v_table_owner IS NULL THEN
      RAISE EXCEPTION 'Preflight failed: public.% does not exist as an ordinary table', v_table;
    END IF;
    IF v_table_owner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Preflight failed: public.% is owned by % (expected postgres)', v_table, v_table_owner;
    END IF;
    IF NOT v_table_rls_enabled THEN
      RAISE EXCEPTION 'Preflight failed: public.% does not have RLS enabled', v_table;
    END IF;
    IF v_table_rls_forced THEN
      RAISE EXCEPTION 'Preflight failed: public.% has FORCE RLS enabled (expected false)', v_table;
    END IF;
  END LOOP;

  SELECT nspowner::regrole INTO v_flowtrack_private_owner
  FROM pg_namespace
  WHERE nspname = 'flowtrack_private';
  IF v_flowtrack_private_owner IS NOT NULL AND v_flowtrack_private_owner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'Preflight failed: flowtrack_private already exists but is owned by % (expected postgres)', v_flowtrack_private_owner;
  END IF;

  RAISE NOTICE 'Preflight passed: all migration preconditions verified.';
END
$mfa_migration_preflight$;
-- ===================== END preflight — Step 1's own baseline captures and ====
-- ===================== the remaining migration body follow below =============

-- Baseline snapshots (Requirement: no static reference to a temp table
-- created earlier in the same SQL Editor batch — this reproduces the same
-- same-batch name-resolution issue Phase 1A hit with a permanent probe
-- table). CREATE TEMP TABLE ... AS SELECT, later read by bare name from a
-- separate top-level statement, is exactly that pattern: the CREATE and
-- every later reference are different top-level statements in the same
-- batch. Fixed here by never creating a named relation at all — each
-- snapshot is captured as a value in a PL/pgSQL variable and stored via
-- set_config(..., true) (transaction-local, gone on ROLLBACK), the same
-- mechanism already used elsewhere in this file to simulate
-- request.jwt.claims and already empirically proven to work in this exact
-- SQL Editor. set_config()/current_setting() are ordinary built-in
-- functions, never subject to same-batch object-resolution timing at all.
-- Multi-row snapshots are serialized as a JSON array (via json_agg, with an
-- explicit ORDER BY so the later text comparison is order-stable);
-- single-row snapshots are stored as individual scalar values, preserving
-- the original per-field failure messages.

DO $capture_policies_before$
DECLARE
  v_snapshot text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.tablename, t.policyname)::text, '[]')
  INTO v_snapshot
  FROM (
    SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  ) t;

  PERFORM set_config('phase1c.policies_before', v_snapshot, true);
END
$capture_policies_before$;

DO $capture_tables_before$
DECLARE
  v_snapshot text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.relname)::text, '[]')
  INTO v_snapshot
  FROM (
    SELECT relname, relowner::regrole::text AS relowner, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  ) t;

  PERFORM set_config('phase1c.tables_before', v_snapshot, true);
END
$capture_tables_before$;

DO $capture_counts_before$
DECLARE
  v_snapshot text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.table_name)::text, '[]')
  INTO v_snapshot
  FROM (
    SELECT 'budgets' AS table_name, count(*) AS row_count FROM public.budgets
    UNION ALL SELECT 'budgets_backup', count(*) FROM public.budgets_backup
    UNION ALL SELECT 'categories', count(*) FROM public.categories
    UNION ALL SELECT 'categories_backup', count(*) FROM public.categories_backup
    UNION ALL SELECT 'debts', count(*) FROM public.debts
    UNION ALL SELECT 'plan', count(*) FROM public.plan
    UNION ALL SELECT 'profiles', count(*) FROM public.profiles
    UNION ALL SELECT 'transactions', count(*) FROM public.transactions
    UNION ALL SELECT 'transactions_backup', count(*) FROM public.transactions_backup
    UNION ALL SELECT 'users', count(*) FROM public.users
  ) t;

  PERFORM set_config('phase1c.counts_before', v_snapshot, true);
END
$capture_counts_before$;

-- Full signup-function/trigger baseline (Requirement 7): captured before
-- the migration body runs, compared field-by-field after. Exotic types
-- (proconfig text[], proacl aclitem[]) are cast to text explicitly for
-- predictable, unambiguous serialization rather than relying on implicit
-- JSON conversion of types with no native JSON mapping.
DO $capture_handle_new_user_before$
DECLARE
  v_functiondef text;
  v_owner       text;
  v_secdef      boolean;
  v_config      text;
  v_acl         text;
BEGIN
  SELECT pg_get_functiondef(p.oid), p.proowner::regrole::text, p.prosecdef, p.proconfig::text, p.proacl::text
  INTO v_functiondef, v_owner, v_secdef, v_config, v_acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Baseline capture failed: public.handle_new_user() was missing before the migration body ran';
  END IF;

  PERFORM set_config('phase1c.hnu_functiondef', v_functiondef, true);
  PERFORM set_config('phase1c.hnu_owner', v_owner, true);
  PERFORM set_config('phase1c.hnu_secdef', v_secdef::text, true);
  PERFORM set_config('phase1c.hnu_config', COALESCE(v_config, '__NULL__'), true);
  PERFORM set_config('phase1c.hnu_acl', COALESCE(v_acl, '__NULL__'), true);
END
$capture_handle_new_user_before$;

DO $capture_trigger_before$
DECLARE
  v_triggerdef text;
  v_tgenabled  text;
  v_tgrelid    text;
  v_tgfoid     text;
  v_tgtype     text;
BEGIN
  SELECT pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgrelid::text, t.tgfoid::text, t.tgtype::text
  INTO v_triggerdef, v_tgenabled, v_tgrelid, v_tgfoid, v_tgtype
  FROM pg_trigger t
  WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;

  IF v_triggerdef IS NULL THEN
    RAISE EXCEPTION 'Baseline capture failed: on_auth_user_created trigger was missing before the migration body ran';
  END IF;

  PERFORM set_config('phase1c.trg_def', v_triggerdef, true);
  PERFORM set_config('phase1c.trg_enabled', v_tgenabled, true);
  PERFORM set_config('phase1c.trg_relid', v_tgrelid, true);
  PERFORM set_config('phase1c.trg_foid', v_tgfoid, true);
  PERFORM set_config('phase1c.trg_type', v_tgtype, true);
END
$capture_trigger_before$;

-- Requirement 5: assert the current (pre-migration) state is EXACTLY the
-- expected 19 pre-existing policies (not just "whatever it is, diffed
-- later") before anything is created. Queries pg_policies directly — a
-- system view that always exists, never a same-batch-created object — no
-- snapshot dependency needed for this particular check.
DO $assert_baseline_policy_count$
DECLARE
  total_count int;
  mismatch text;
BEGIN
  SELECT count(*) INTO total_count FROM pg_policies WHERE schemaname = 'public';
  IF total_count <> 19 THEN
    RAISE EXCEPTION 'Baseline check failed: expected exactly 19 pre-existing policies before this migration runs, found %', total_count;
  END IF;

  SELECT string_agg(t.tablename || ': expected ' || t.expected_count || ', found ' || COALESCE(b.actual_count, 0), '; ')
  INTO mismatch
  FROM (VALUES
    ('budgets', 4), ('categories', 4), ('debts', 4),
    ('profiles', 3), ('transactions', 1), ('users', 3)
  ) AS t(tablename, expected_count)
  LEFT JOIN (
    SELECT tablename, count(*) AS actual_count
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY tablename
  ) b ON b.tablename = t.tablename
  WHERE COALESCE(b.actual_count, 0) <> t.expected_count;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Baseline check failed: pre-existing policy distribution does not match the verified Phase 1A baseline: %', mismatch;
  END IF;

  RAISE NOTICE 'Assertion passed: baseline contains exactly the expected 19 pre-existing policies (4/4/4/3/1/3 across budgets/categories/debts/profiles/transactions/users).';
END
$assert_baseline_policy_count$;

-- ===================== BEGIN migration body, continued (identical to =========
-- ===================== lib/security/migration_mfa_enforcement.sql) ============
-- The preflight (0.) already ran as the very first statement after BEGIN;,
-- above — see the top of this Step 1 block.

DO $ensure_flowtrack_private_schema$
DECLARE
  existing_owner regrole;
BEGIN
  SELECT nspowner::regrole INTO existing_owner
  FROM pg_namespace
  WHERE nspname = 'flowtrack_private';

  IF existing_owner IS NULL THEN
    CREATE SCHEMA flowtrack_private AUTHORIZATION postgres;
  ELSIF existing_owner <> 'postgres'::regrole THEN
    RAISE EXCEPTION
      'flowtrack_private already exists but is owned by % (expected postgres) — refusing to proceed.',
      existing_owner;
  END IF;
END
$ensure_flowtrack_private_schema$;

REVOKE ALL ON SCHEMA flowtrack_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA flowtrack_private TO authenticated;

CREATE OR REPLACE FUNCTION flowtrack_private.mfa_access_allowed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_uid               uuid;
  current_aal               text;
  is_valid_aal              boolean;
  has_verified_totp_factor  boolean;
BEGIN
  current_uid := auth.uid();
  IF current_uid IS NULL THEN
    RETURN false;
  END IF;

  current_aal := auth.jwt() ->> 'aal';
  is_valid_aal := current_aal IS NOT NULL AND current_aal IN ('aal1', 'aal2');
  IF NOT is_valid_aal THEN
    RETURN false;
  END IF;

  -- FlowTrack Phase 1B supports TOTP only: enrollment means exactly
  -- factor_type = 'totp' AND status = 'verified', never any verified
  -- factor of any type.
  SELECT EXISTS (
    SELECT 1
    FROM auth.mfa_factors
    WHERE auth.mfa_factors.user_id = current_uid
      AND auth.mfa_factors.factor_type = 'totp'
      AND auth.mfa_factors.status = 'verified'
  )
  INTO has_verified_totp_factor;

  RETURN is_valid_aal AND (NOT has_verified_totp_factor OR current_aal = 'aal2');
END;
$$;

REVOKE EXECUTE ON FUNCTION flowtrack_private.mfa_access_allowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION flowtrack_private.mfa_access_allowed() TO authenticated;

DROP POLICY IF EXISTS mfa_required_if_enrolled_budgets ON public.budgets;
CREATE POLICY mfa_required_if_enrolled_budgets ON public.budgets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_categories ON public.categories;
CREATE POLICY mfa_required_if_enrolled_categories ON public.categories
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_debts ON public.debts;
CREATE POLICY mfa_required_if_enrolled_debts ON public.debts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_profiles ON public.profiles;
CREATE POLICY mfa_required_if_enrolled_profiles ON public.profiles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_transactions ON public.transactions;
CREATE POLICY mfa_required_if_enrolled_transactions ON public.transactions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_users ON public.users;
CREATE POLICY mfa_required_if_enrolled_users ON public.users
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

-- ===================== END migration body ======================================

-- ----- Self-verifying assertions (each RAISE EXCEPTION on failure) -----

DO $assert_existing_policies_unchanged$
DECLARE
  v_before text := current_setting('phase1c.policies_before', true);
  v_after  text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.tablename, t.policyname)::text, '[]')
  INTO v_after
  FROM (
    SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname NOT LIKE 'mfa_required_if_enrolled_%'
  ) t;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Baseline capture failed: phase1c.policies_before was never set';
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Expected all 19 existing policies to remain byte-for-byte unchanged (snapshot mismatch)';
  END IF;
  RAISE NOTICE 'Assertion passed: all 19 existing policies remain byte-for-byte unchanged.';
END
$assert_existing_policies_unchanged$;

-- Requirement 6: strengthened — exactly one per table, RESTRICTIVE, ALL,
-- authenticated-only, both qual and with_check present, and both
-- expressions reference flowtrack_private.mfa_access_allowed().
DO $assert_new_policies$
DECLARE
  expected_tables text[] := ARRAY['budgets','categories','debts','profiles','transactions','users'];
  t text;
  found_count int;
  v_qual text;
  v_with_check text;
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    SELECT count(*) INTO found_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = t
      AND policyname = 'mfa_required_if_enrolled_' || t
      AND permissive = 'RESTRICTIVE'
      AND roles = ARRAY['authenticated']::name[]
      AND cmd = 'ALL';
    IF found_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one restrictive mfa_required_if_enrolled policy on public.% (RESTRICTIVE, {authenticated}, ALL), found %', t, found_count;
    END IF;

    SELECT qual, with_check INTO v_qual, v_with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t AND policyname = 'mfa_required_if_enrolled_' || t;

    IF v_qual IS NULL THEN
      RAISE EXCEPTION 'Expected a USING (qual) expression on the public.% mfa policy, found NULL', t;
    END IF;
    IF v_with_check IS NULL THEN
      RAISE EXCEPTION 'Expected a WITH CHECK expression on the public.% mfa policy, found NULL', t;
    END IF;
    IF v_qual NOT LIKE '%flowtrack_private.mfa_access_allowed%' THEN
      RAISE EXCEPTION 'Expected the USING expression on public.% to reference flowtrack_private.mfa_access_allowed(), got: %', t, v_qual;
    END IF;
    IF v_with_check NOT LIKE '%flowtrack_private.mfa_access_allowed%' THEN
      RAISE EXCEPTION 'Expected the WITH CHECK expression on public.% to reference flowtrack_private.mfa_access_allowed(), got: %', t, v_with_check;
    END IF;
  END LOOP;
  RAISE NOTICE 'Assertion passed: all six restrictive policies exist with the correct role/command, and both qual/with_check reference the helper.';
END
$assert_new_policies$;

DO $assert_backup_and_plan_untouched$
DECLARE
  policy_count int;
BEGIN
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('plan', 'budgets_backup', 'categories_backup', 'transactions_backup');
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'Expected zero policies on plan/backup tables, found %', policy_count;
  END IF;
  RAISE NOTICE 'Assertion passed: plan and the three backup tables remain untouched (zero policies).';
END
$assert_backup_and_plan_untouched$;

DO $assert_schema_grants$
BEGIN
  IF NOT has_schema_privilege('authenticated', 'flowtrack_private', 'USAGE') THEN
    RAISE EXCEPTION 'Expected authenticated to have USAGE on flowtrack_private';
  END IF;
  IF has_schema_privilege('authenticated', 'flowtrack_private', 'CREATE') THEN
    RAISE EXCEPTION 'authenticated must NOT have CREATE on flowtrack_private';
  END IF;
  IF has_schema_privilege('anon', 'flowtrack_private', 'USAGE') THEN
    RAISE EXCEPTION 'anon must NOT have USAGE on flowtrack_private';
  END IF;
  IF has_schema_privilege('anon', 'flowtrack_private', 'CREATE') THEN
    RAISE EXCEPTION 'anon must NOT have CREATE on flowtrack_private';
  END IF;
  RAISE NOTICE 'Assertion passed: schema grants are exactly as intended (authenticated USAGE-only, anon nothing).';
END
$assert_schema_grants$;

DO $assert_function_execute$
BEGIN
  IF NOT has_function_privilege('authenticated', 'flowtrack_private.mfa_access_allowed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Expected authenticated to have EXECUTE on flowtrack_private.mfa_access_allowed()';
  END IF;
  IF has_function_privilege('anon', 'flowtrack_private.mfa_access_allowed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on flowtrack_private.mfa_access_allowed()';
  END IF;
  -- PUBLIC has no queryable role name for has_function_privilege(); checked
  -- via aclexplode grantee = 0, per the established Phase 1A convention.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'flowtrack_private'
      AND p.proname = 'mfa_access_allowed'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have EXECUTE on flowtrack_private.mfa_access_allowed()';
  END IF;
  RAISE NOTICE 'Assertion passed: only authenticated can execute the helper.';
END
$assert_function_execute$;

-- Requirement 8: the helper's shape — postgres-owned, STABLE, SECURITY
-- DEFINER, empty search_path, zero arguments, returns boolean.
DO $assert_helper_shape$
DECLARE
  v_owner regrole;
  v_volatile "char";
  v_secdef boolean;
  v_nargs int;
  v_rettype text;
  v_search_path_entry text;
  v_search_path_value text;
BEGIN
  SELECT
    p.proowner::regrole, p.provolatile, p.prosecdef, p.pronargs,
    pg_get_function_result(p.oid),
    (SELECT cfg FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%')
  INTO v_owner, v_volatile, v_secdef, v_nargs, v_rettype, v_search_path_entry
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'flowtrack_private' AND p.proname = 'mfa_access_allowed';

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: flowtrack_private.mfa_access_allowed() does not exist';
  END IF;
  IF v_owner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to be owned by postgres, found %', v_owner;
  END IF;
  IF v_volatile <> 's' THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to be STABLE, found provolatile = %', v_volatile;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to be SECURITY DEFINER';
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to take zero arguments, found %', v_nargs;
  END IF;
  IF v_rettype <> 'boolean' THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to return boolean, found %', v_rettype;
  END IF;
  IF v_search_path_entry IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to have a fixed search_path, found none in proconfig';
  END IF;
  v_search_path_value := btrim(substring(v_search_path_entry FROM position('=' IN v_search_path_entry) + 1), '"');
  IF v_search_path_value <> '' THEN
    RAISE EXCEPTION 'Assertion failed: expected flowtrack_private.mfa_access_allowed() to have an empty search_path, found %', v_search_path_value;
  END IF;

  RAISE NOTICE 'Assertion passed: helper is postgres-owned, STABLE, SECURITY DEFINER, zero-argument, returns boolean, with an empty search_path.';
END
$assert_helper_shape$;

-- Functional assertions. These simulate the request.jwt.claims GUC that
-- PostgREST sets per-request — the standard way to exercise auth.uid()/
-- auth.jwt() from the SQL Editor. Every simulated value is set via
-- set_config(..., true) with valid JSON (never RESET, which would leave
-- the GUC undefined and put auth.jwt()'s behavior for an unset GUC at the
-- mercy of an unverified implementation detail). postgres can always call
-- a function it owns directly regardless of that function's own EXECUTE
-- grants (grants restrict OTHER roles, not the owner) — the assertion
-- after these three exercises the real authenticated execution path
-- separately. No row is ever inserted into auth.mfa_factors: production is
-- verified to currently hold zero rows, so any synthetic uuid below
-- correctly has "no verified TOTP factor" without needing one. If
-- request.jwt.claims does not behave as expected in this project, these
-- blocks will fail with a clear error rather than a false pass — report
-- the exact error rather than assuming success.
--
-- NOTE on scope: because no row may be inserted into auth.mfa_factors
-- (even a rolled-back one), these functional assertions cannot empirically
-- exercise the factor_type = 'totp' filter against a real verified phone
-- or webauthn row — every synthetic uuid here has zero rows of any type,
-- so the filter is structurally present but not distinguished by these
-- specific runs. That distinction (verified TOTP => enrolled; verified
-- phone/webauthn => not enrolled) is proven instead by source-content
-- assertions against this exact SQL text, plus real unit tests of the
-- identical rule in lib/mfa/factors.ts shared by the server and client —
-- see lib/security/migration_mfa_enforcement.test.ts and
-- lib/mfa/factors.test.ts. Likewise, a real verified-TOTP-enrolled
-- aal1-vs-aal2 exercise is deferred to the supervised Step 4 test, since
-- production currently has zero factors and none may be synthesized here.

DO $assert_missing_uid$
DECLARE
  result boolean;
BEGIN
  -- A valid empty JSON object, not an unset/RESET GUC: auth.jwt() always
  -- receives well-formed JSON, and ->> 'sub' on an object with no such key
  -- is NULL, which is exactly the "missing uid" case this asserts.
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT flowtrack_private.mfa_access_allowed() INTO result;
  IF result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Expected false with an empty claims object (no sub), got %', result;
  END IF;
  RAISE NOTICE 'Assertion passed: missing uid (empty claims object) returns false.';
END
$assert_missing_uid$;

DO $assert_invalid_or_missing_aal$
DECLARE
  result boolean;
  fake_uid uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', fake_uid, 'aal', 'not-a-real-level')::text, true);
  SELECT flowtrack_private.mfa_access_allowed() INTO result;
  IF result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Expected false with an invalid aal claim, got %', result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', fake_uid)::text, true);  -- valid JSON, aal key entirely absent
  SELECT flowtrack_private.mfa_access_allowed() INTO result;
  IF result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Expected false with a missing aal claim, got %', result;
  END IF;

  RAISE NOTICE 'Assertion passed: invalid or missing aal claim returns false.';
END
$assert_invalid_or_missing_aal$;

DO $assert_valid_aal1_no_factor_allowed$
DECLARE
  result boolean;
  fake_uid uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', fake_uid, 'aal', 'aal1')::text, true);
  SELECT flowtrack_private.mfa_access_allowed() INTO result;
  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Expected true for a valid aal1 identity with no verified TOTP factor, got %', result;
  END IF;
  RAISE NOTICE 'Assertion passed: a valid aal1 identity with no verified TOTP factor is allowed.';
END
$assert_valid_aal1_no_factor_allowed$;

-- Requirement 4: prove the real authenticated execution path, not merely
-- calling the function as its postgres owner (which always succeeds
-- regardless of EXECUTE grants, since ownership is a separate right from
-- ACL grants). RESET ROLE is guaranteed on every path, including failure,
-- via the nested exception handler below.
DO $assert_authenticated_execution_path$
DECLARE
  is_member boolean;
  result boolean;
  fake_uid uuid := '00000000-0000-0000-0000-000000000002';
BEGIN
  is_member := pg_has_role(current_user, 'authenticated', 'MEMBER');
  IF NOT is_member THEN
    RAISE EXCEPTION 'Preflight failed: current_user (%) is not a member of authenticated — cannot exercise the real authenticated execution path', current_user;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', fake_uid, 'aal', 'aal1')::text, true);

  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT flowtrack_private.mfa_access_allowed() INTO result;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'Assertion failed: exercising mfa_access_allowed() as authenticated raised an unexpected error: %', SQLERRM;
  END;

  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: authenticated-role execution with a valid aal1, no-factor identity should return true, got %', result;
  END IF;

  RAISE NOTICE 'Assertion passed: flowtrack_private.mfa_access_allowed() executes correctly when actually called as authenticated (not merely as its postgres owner).';
END
$assert_authenticated_execution_path$;

-- Restore the JWT-claims GUC to a deterministic, valid-JSON state before
-- the remaining (non-JWT-dependent) assertions run. A plain top-level
-- SELECT calling set_config() — never a bare top-level EXECUTE, which is
-- not valid syntax outside PL/pgSQL, and never RESET.
SELECT set_config('request.jwt.claims', '{}', true);

DO $assert_table_stats_unchanged$
DECLARE
  v_before text := current_setting('phase1c.tables_before', true);
  v_after  text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.relname)::text, '[]')
  INTO v_after
  FROM (
    SELECT relname, relowner::regrole::text AS relowner, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  ) t;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Baseline capture failed: phase1c.tables_before was never set';
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Expected owner/RLS/FORCE flags unchanged on every table (snapshot mismatch)';
  END IF;
  RAISE NOTICE 'Assertion passed: owner, RLS, and FORCE flags unchanged on every table.';
END
$assert_table_stats_unchanged$;

DO $assert_row_counts_unchanged$
DECLARE
  v_before text := current_setting('phase1c.counts_before', true);
  v_after  text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.table_name)::text, '[]')
  INTO v_after
  FROM (
    SELECT 'budgets' AS table_name, count(*) AS row_count FROM public.budgets
    UNION ALL SELECT 'budgets_backup', count(*) FROM public.budgets_backup
    UNION ALL SELECT 'categories', count(*) FROM public.categories
    UNION ALL SELECT 'categories_backup', count(*) FROM public.categories_backup
    UNION ALL SELECT 'debts', count(*) FROM public.debts
    UNION ALL SELECT 'plan', count(*) FROM public.plan
    UNION ALL SELECT 'profiles', count(*) FROM public.profiles
    UNION ALL SELECT 'transactions', count(*) FROM public.transactions
    UNION ALL SELECT 'transactions_backup', count(*) FROM public.transactions_backup
    UNION ALL SELECT 'users', count(*) FROM public.users
  ) t;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Baseline capture failed: phase1c.counts_before was never set';
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Expected row counts unchanged on every table (snapshot mismatch)';
  END IF;
  RAISE NOTICE 'Assertion passed: row counts unchanged on every table.';
END
$assert_row_counts_unchanged$;

-- Requirement 7: full signup-function/trigger baseline comparison —
-- exact pg_get_functiondef()/pg_get_triggerdef() text, owner, prosecdef,
-- proconfig, proacl, tgenabled, tgrelid, tgfoid, tgtype — all compared
-- byte-for-byte against the snapshot captured before the migration body ran.
DO $assert_handle_new_user_intact$
DECLARE
  v_functiondef text;
  v_owner       text;
  v_secdef      boolean;
  v_config      text;
  v_acl         text;
  v_triggerdef  text;
  v_tgenabled   text;
  v_tgrelid     text;
  v_tgfoid      text;
  v_tgtype      text;
BEGIN
  SELECT pg_get_functiondef(p.oid), p.proowner::regrole::text, p.prosecdef, p.proconfig::text, p.proacl::text
  INTO v_functiondef, v_owner, v_secdef, v_config, v_acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() is missing after the migration body ran';
  END IF;
  IF v_functiondef IS DISTINCT FROM current_setting('phase1c.hnu_functiondef', true) THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() definition changed';
  END IF;
  IF v_owner IS DISTINCT FROM current_setting('phase1c.hnu_owner', true) THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() owner changed to %', v_owner;
  END IF;
  IF v_secdef::text IS DISTINCT FROM current_setting('phase1c.hnu_secdef', true) THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() prosecdef changed to %', v_secdef;
  END IF;
  IF COALESCE(v_config, '__NULL__') IS DISTINCT FROM current_setting('phase1c.hnu_config', true) THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() proconfig changed';
  END IF;
  IF COALESCE(v_acl, '__NULL__') IS DISTINCT FROM current_setting('phase1c.hnu_acl', true) THEN
    RAISE EXCEPTION 'Assertion failed: public.handle_new_user() proacl changed';
  END IF;

  SELECT pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgrelid::text, t.tgfoid::text, t.tgtype::text
  INTO v_triggerdef, v_tgenabled, v_tgrelid, v_tgfoid, v_tgtype
  FROM pg_trigger t
  WHERE t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;

  IF v_triggerdef IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created trigger is missing after the migration body ran';
  END IF;
  IF v_triggerdef IS DISTINCT FROM current_setting('phase1c.trg_def', true) THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created trigger definition changed';
  END IF;
  IF v_tgenabled IS DISTINCT FROM current_setting('phase1c.trg_enabled', true) THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created tgenabled changed to %', v_tgenabled;
  END IF;
  IF v_tgrelid IS DISTINCT FROM current_setting('phase1c.trg_relid', true) THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created tgrelid changed';
  END IF;
  IF v_tgfoid IS DISTINCT FROM current_setting('phase1c.trg_foid', true) THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created tgfoid changed';
  END IF;
  IF v_tgtype IS DISTINCT FROM current_setting('phase1c.trg_type', true) THEN
    RAISE EXCEPTION 'Assertion failed: on_auth_user_created tgtype changed to %', v_tgtype;
  END IF;

  RAISE NOTICE 'Assertion passed: handle_new_user() and on_auth_user_created are completely unchanged (function definition, owner, prosecdef, proconfig, proacl; trigger definition, tgenabled, tgrelid, tgfoid, tgtype).';
END
$assert_handle_new_user_intact$;

ROLLBACK;

-- Unambiguous final status, after ROLLBACK. Confirms every object this dry
-- run created has been completely removed.
SELECT
  NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'flowtrack_private') AS schema_gone,
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'flowtrack_private' AND p.proname = 'mfa_access_allowed'
  ) AS function_gone,
  NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'mfa_required_if_enrolled_%'
  ) AS policies_gone;

-- =======================================================================
-- STEP 2 — apply the real migration.
-- Run lib/security/migration_mfa_enforcement.sql directly (not this
-- runbook) once Step 1's dry run and all assertions have passed.
-- =======================================================================

-- =======================================================================
-- STEP 3 — post-migration verification. Re-run every Step 0 query (0a
-- through 0h) and compare:
--   - 0a/0b: identical to Step 0 (row counts, owners, RLS/FORCE flags).
--   - 0c: now 25 policies — the original 19, unchanged, plus the 6 new
--     mfa_required_if_enrolled_* RESTRICTIVE policies.
--   - 0d: flowtrack_private now exists, owned by postgres.
--   - 0e: auth.mfa_factors itself is completely unchanged (this migration
--     never alters it) — only the queries that read it changed.
--   - 0f: handle_new_user()/on_auth_user_created unchanged.
--   - 0g: still zero rows (this migration inserts nothing).
--   - 0h: enum labels unchanged (this migration never alters auth.mfa_factors).
-- Also run:
SELECT has_schema_privilege('authenticated', 'flowtrack_private', 'USAGE')  AS authenticated_usage,
       has_schema_privilege('authenticated', 'flowtrack_private', 'CREATE') AS authenticated_create,
       has_schema_privilege('anon', 'flowtrack_private', 'USAGE')           AS anon_usage,
       has_schema_privilege('anon', 'flowtrack_private', 'CREATE')          AS anon_create,
       has_function_privilege('authenticated', 'flowtrack_private.mfa_access_allowed()', 'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon', 'flowtrack_private.mfa_access_allowed()', 'EXECUTE')           AS anon_execute;

-- =======================================================================
-- STEP 4 — supervised manual test matrix. Requires a real, disposable test
-- account — production currently has zero MFA factors, so this cannot be
-- automated in SQL alone. Do not use a real customer account.
-- =======================================================================
-- 1. Non-enrolled test account: confirm dashboard/settings/restore/
--    debt-recovery/bill-guardian all load exactly as before (aal1, no
--    verified TOTP factor — mfa_access_allowed() returns true, RESTRICTIVE
--    policies are a no-op for this account).
-- 2. Same account enrolls and verifies a TOTP factor via Settings →
--    Security (Phase 1B UI). Confirm the app's own AuthContext gate routes
--    it through /mfa-challenge as already built — this runbook does not
--    change that flow.
-- 3. While the browser session is still aal1 (immediately after password
--    login, before completing the challenge, if reachable via direct API
--    call rather than the UI gate): confirm a direct PostgREST read against
--    one of the six tables (e.g. a `select` on transactions) is denied.
-- 4. Complete the MFA challenge (aal2). Confirm all six tables' normal
--    reads/writes work exactly as before enrollment.
-- 5. Remove the verified TOTP factor (back to non-enrolled). Confirm access
--    returns to normal at aal1, with no lingering restriction.
-- 6. Checkout/portal: repeat steps 1-5 against POST /api/stripe/checkout
--    and /api/stripe/portal with a real (test-mode) bearer token, confirming
--    the same aal1-when-enrolled denial (generic 403) and aal2-when-
--    enrolled/aal1-when-not-enrolled allow behavior.
-- 7. Not testable through the current product (FlowTrack's Settings UI only
--    offers TOTP enrollment — there is no phone/webauthn enrollment flow to
--    exercise): a verified phone or webauthn factor must not count as
--    enrolled. This is proven structurally instead — see the NOTE above
--    Step 1's functional assertions, and lib/mfa/factors.test.ts.
-- Report pass/fail for each numbered item.

-- =======================================================================
-- STEP 5 — narrow rollback. Drops only this migration's own objects: the
-- six new policies, the helper function, and the flowtrack_private schema
-- itself. No CASCADE — if flowtrack_private ever holds anything besides
-- this one function, DROP SCHEMA will fail loudly instead of silently
-- deleting it, which is the desired behavior.
-- =======================================================================

BEGIN;

DROP POLICY IF EXISTS mfa_required_if_enrolled_budgets ON public.budgets;
DROP POLICY IF EXISTS mfa_required_if_enrolled_categories ON public.categories;
DROP POLICY IF EXISTS mfa_required_if_enrolled_debts ON public.debts;
DROP POLICY IF EXISTS mfa_required_if_enrolled_profiles ON public.profiles;
DROP POLICY IF EXISTS mfa_required_if_enrolled_transactions ON public.transactions;
DROP POLICY IF EXISTS mfa_required_if_enrolled_users ON public.users;

DROP FUNCTION IF EXISTS flowtrack_private.mfa_access_allowed();

DROP SCHEMA flowtrack_private;
-- No IF EXISTS and no CASCADE here deliberately: if this schema does not
-- exist, or still contains something this rollback didn't already remove,
-- this statement should fail loudly rather than silently do nothing or
-- silently delete something unexpected.

COMMIT;

-- Re-run Step 0c and Step 0b afterward and confirm: exactly the original 19
-- policies remain, byte-for-byte; all ten tables' owner/RLS/FORCE flags are
-- unchanged; flowtrack_private no longer exists.
