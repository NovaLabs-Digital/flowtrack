-- FlowTrack: Optional-MFA restrictive RLS enforcement (Security Phase 1C)
-- non-destructive. Run this independently in the Supabase SQL Editor, after
-- lib/security/mfa_enforcement_runbook.sql Steps 0 and 1. Safe to run more
-- than once (see "Repeatability" below). Wrapped in a single transaction:
-- any failure rolls back everything, so there is never a partially-applied
-- state. This is a separate, standalone migration — it does NOT modify or
-- reapply lib/security/migration_privilege_hardening.sql (Phase 1A).
--
-- Verified production facts this migration is scoped to (confirmed by
-- Alberto, not assumed):
--   - auth.mfa_factors is an ordinary table (relkind 'r'), owned by
--     supabase_auth_admin, RLS enabled, FORCE RLS false, with zero RLS
--     policies of its own, and zero PUBLIC/anon/authenticated ACL entries.
--   - postgres is not a superuser but has rolbypassrls = true, and already
--     has USAGE on schema auth and SELECT on auth.mfa_factors. Because
--     rolbypassrls is true, postgres has complete, authoritative visibility
--     into auth.mfa_factors regardless of that table's own RLS state — this
--     is not an assumption, it is what rolbypassrls means.
--   - auth.mfa_factors has `user_id uuid`, `factor_type` (enum: totp,
--     webauthn, phone), and `status` (enum: unverified, verified) columns.
--     FlowTrack Phase 1B supports TOTP only, so enrollment is defined
--     consistently everywhere in this project as
--     factor_type = 'totp' AND status = 'verified' — a verified phone or
--     WebAuthn factor does NOT count as enrolled for Phase 1C purposes.
--   - All ten FlowTrack public tables are postgres-owned, RLS enabled,
--     FORCE RLS false — so postgres, as owner, is exempt from RLS on all of
--     them (relevant to why handle_new_user()'s INSERT into public.profiles
--     is unaffected by the new restrictive policies below).
--   - flowtrack_private does not currently exist.
--   - Production currently has zero rows in auth.mfa_factors.
--
-- Optional-MFA semantics implemented: a user with no verified TOTP factor
-- may access their own data at aal1 (unchanged from today); a user with at
-- least one verified TOTP factor must be at aal2. Missing, invalid, or
-- unverifiable AAL/enrollment state fails closed (denies), never defaults
-- to allow.
--
-- Enforcement mechanism: one new SECURITY DEFINER helper function,
-- flowtrack_private.mfa_access_allowed(), performing a live query-time
-- lookup against auth.mfa_factors on every evaluation (never a cached/
-- mirrored value) — plus one new RESTRICTIVE policy per table on the six
-- tables that currently have real ownership policies. RESTRICTIVE policies
-- AND with every PERMISSIVE policy already on the table; they narrow access,
-- they cannot widen it. The 19 existing ownership policies (Phase 1A
-- baseline) are never altered, replaced, renamed, or dropped by this file.
--
-- Deliberately NOT touched: public.plan, public.budgets_backup,
-- public.categories_backup, public.transactions_backup (zero existing
-- policies today — a restrictive policy there would be a no-op, since
-- restrictive policies only narrow an existing permissive grant and none
-- exists on these four tables); Stripe/webhook/cron/support routes and all
-- service-role database access (service_role bypasses RLS entirely, so
-- restrictive RLS policies cannot and do not protect those paths — see
-- lib/mfa/serverAuthorize.ts for the separate, API-layer enforcement that
-- exists specifically because of this); signup, password reset, and
-- handle_new_user()'s INSERT/ON CONFLICT behavior; any row of data.
--
-- Repeatability: the schema-existence check below is idempotent and fails
-- loudly (RAISE EXCEPTION) rather than silently proceeding if
-- flowtrack_private already exists under a different owner. The function
-- uses CREATE OR REPLACE. The six policies are dropped-then-recreated by
-- name. Re-running this file after a successful apply is a safe no-op that
-- only ever replaces this migration's own objects — it never broadens any
-- existing grant and never touches the 19 existing policies.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preflight: fail loudly, before touching anything, unless every
-- verified production fact this migration depends on is still true. This
-- guards against ever running this file against an environment where those
-- facts have drifted (a different project, a changed role setup, a renamed
-- column) — it does not assume, it checks.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- A. flowtrack_private: a dedicated schema, not part of PostgREST's
-- exposed-schema list (a Supabase Dashboard/API setting — confirm
-- separately, not verifiable via SQL), for the helper function below.
-- Fails loudly rather than silently proceeding if a schema by this name
-- already exists with an unexpected owner.
-- ---------------------------------------------------------------------
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
      'flowtrack_private already exists but is owned by % (expected postgres) — refusing to proceed. Investigate before re-running this migration.',
      existing_owner;
  END IF;
  -- else: already exists, already postgres-owned — no-op, safely repeatable.
END
$ensure_flowtrack_private_schema$;

REVOKE ALL ON SCHEMA flowtrack_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA flowtrack_private TO authenticated;
-- Deliberately no CREATE grant to authenticated, or to anyone but postgres.

-- ---------------------------------------------------------------------
-- B. flowtrack_private.mfa_access_allowed(): zero-argument, STABLE,
-- SECURITY DEFINER helper implementing the optional-MFA predicate:
--   valid_aal AND (NOT enrolled OR aal = 'aal2')
-- where "enrolled" means exactly factor_type = 'totp' AND status =
-- 'verified' — never "any verified factor". Derives auth.uid() and
-- auth.jwt()->>'aal' internally — never takes a parameter, so it can never
-- be asked about any user other than the caller. Owned by postgres, which
-- has rolbypassrls = true, so its EXISTS query against auth.mfa_factors
-- sees the complete, authoritative row set regardless of that table's own
-- RLS state.
-- ---------------------------------------------------------------------
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
  -- Explicit IS NOT NULL guard is required: PL/pgSQL's `IF NOT x THEN`
  -- treats a NULL condition as false (does not enter the branch), so
  -- is_valid_aal must never itself be left NULL, or a missing claim would
  -- silently fall through instead of being rejected immediately.
  is_valid_aal := current_aal IS NOT NULL AND current_aal IN ('aal1', 'aal2');
  IF NOT is_valid_aal THEN
    RETURN false;
  END IF;

  -- Live query-time lookup — never a cached/mirrored value. Checks only the
  -- caller's own factors (current_uid comes from auth.uid(), not a
  -- parameter), and only verified TOTP factors — FlowTrack Phase 1B
  -- supports TOTP only, so a verified phone or WebAuthn factor must NOT
  -- count as enrolled here. Returns a boolean only: no factor id, secret,
  -- row, or count is ever selected or exposed.
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
-- Belt-and-suspenders with the schema not being PostgREST-exposed: even if
-- flowtrack_private were ever added to the exposed-schema list, this grant
-- alone still keeps the function unreachable by anon/PUBLIC.

-- ---------------------------------------------------------------------
-- C. One RESTRICTIVE policy per table, on exactly the six tables that
-- currently have real ownership (PERMISSIVE) policies. RESTRICTIVE
-- policies compose with ANDs against every applicable PERMISSIVE policy on
-- the same table — they can only narrow access, never grant it, and they
-- do not require touching, reordering, or replacing the 19 existing
-- policies at all. Scoped TO authenticated (not TO public/anon): the
-- entire predicate depends on auth.uid()/auth.jwt(), which are meaningless
-- for anon; anon's access remains governed solely by the pre-existing
-- permissive policies (already effectively closed to it). Wrapped in
-- (SELECT ...) so Postgres can evaluate it once per statement as an
-- initPlan rather than once per row (the standard Supabase-documented RLS
-- performance pattern).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS mfa_required_if_enrolled_budgets ON public.budgets;
CREATE POLICY mfa_required_if_enrolled_budgets
  ON public.budgets
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_categories ON public.categories;
CREATE POLICY mfa_required_if_enrolled_categories
  ON public.categories
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_debts ON public.debts;
CREATE POLICY mfa_required_if_enrolled_debts
  ON public.debts
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_profiles ON public.profiles;
CREATE POLICY mfa_required_if_enrolled_profiles
  ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_transactions ON public.transactions;
CREATE POLICY mfa_required_if_enrolled_transactions
  ON public.transactions
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

DROP POLICY IF EXISTS mfa_required_if_enrolled_users ON public.users;
CREATE POLICY mfa_required_if_enrolled_users
  ON public.users
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ( (SELECT flowtrack_private.mfa_access_allowed()) )
  WITH CHECK ( (SELECT flowtrack_private.mfa_access_allowed()) );

-- Deliberately NOT added to public.plan, public.budgets_backup,
-- public.categories_backup, public.transactions_backup — see header note.

COMMIT;
