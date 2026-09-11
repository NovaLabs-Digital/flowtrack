-- FlowTrack: "launch cohort" one-time email campaign — dry run,
-- verification, manual enrollment, and rollback runbook. Companion to
-- lib/security/migration_launch_cohort.sql.
--
-- NOTHING IN THIS FILE HAS BEEN EXECUTED. Alberto runs each step manually
-- in the Supabase SQL Editor, in order, reading the output at each step
-- before proceeding. Separate in every respect from
-- lib/security/lifecycle_emails_runbook.sql — running this file does not
-- touch lifecycle_emails, its RPCs, or its cron.
--
-- Lesson carried over from Security Phase 1C / the lifecycle-emails work
-- (see mfa_enforcement_runbook.sql and lifecycle_emails_runbook.sql): a
-- bare CREATE TEMP TABLE, later referenced by name from a SEPARATE
-- top-level statement in the same SQL Editor batch, can fail with 42P01
-- even though the object was just created. This runbook uses
-- set_config()/current_setting() GUCs for every "snapshot now, compare
-- later" check and creates no temp table anywhere.
--
-- Second lesson carried over from the lifecycle-emails work: a PUBLIC-ACL
-- assertion written as "SELECT count(*) INTO a_scalar_variable FROM
-- aclexplode(...) WHERE ..." is ambiguous with plain SQL's legacy
-- "SELECT ... INTO tablename FROM ..." form and failed in production with
-- "relation ... does not exist". Every PUBLIC-ACL check below uses
-- IF EXISTS(...) instead, which has no INTO clause and cannot hit that
-- ambiguity.
--
-- Third lesson carried over: Supabase grants service_role ALL PRIVILEGES
-- on every new public-schema table by default. Every REVOKE ALL in the
-- companion migration already includes service_role from the start (see
-- migration_launch_cohort.sql Section B), so this runbook's Step 1 tests
-- that fact directly rather than discovering it the hard way again.

-- =======================================================================
-- STEP 0: Baseline inventory (read-only, no transaction needed)
-- =======================================================================
-- Run this first and keep its output. Confirms the starting state this
-- migration assumes — including that lifecycle_emails is already live
-- (the prior, separate campaign), so the "before" table count here is 11,
-- not 10.

SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_members'
) AS launch_cohort_members_already_exists; -- expect: false

SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_emails'
) AS launch_cohort_emails_already_exists; -- expect: false

SELECT count(*) AS current_public_table_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'; -- record this number (expect: 11)

SELECT count(*) AS current_policy_count FROM pg_policies WHERE schemaname = 'public';
-- expect: 25 (unchanged by lifecycle_emails, which also ships with zero policies)

SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('postgres', 'service_role', 'authenticated', 'anon');

SELECT count(*) AS existing_auth_users_count FROM auth.users; -- informational only


-- =======================================================================
-- STEP 1: Transactional dry run (rolled back — nothing persists)
-- =======================================================================
-- Paste and run this entire block as one execution. Ends in ROLLBACK, so
-- no table, function, grant, or row created here survives. Contains the
-- COMPLETE migration body inline — the preflight section immediately
-- below is byte-for-byte identical to migration_launch_cohort.sql's own
-- preflight, and the table/index/RLS/grant/function section further below
-- (after the GUC snapshot) is byte-for-byte identical to that file's own
-- body after its preflight, excluding only that file's own leading and
-- trailing transaction-control statements.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preflight: fail loudly, before touching anything, unless every fact
-- this migration depends on is still true.
-- ---------------------------------------------------------------------
DO $launch_cohort_migration_preflight$
DECLARE
  v_postgres_bypassrls        boolean;
  v_service_role_exists       boolean;
  v_users_id_type              text;
  v_members_table_exists       boolean;
  v_emails_table_exists         boolean;
  v_probe                      uuid;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Preflight failed: current_user is % (expected postgres)', current_user;
  END IF;

  SELECT rolbypassrls INTO v_postgres_bypassrls FROM pg_roles WHERE rolname = 'postgres';
  IF v_postgres_bypassrls IS NOT TRUE THEN
    RAISE EXCEPTION 'Preflight failed: postgres.rolbypassrls is not true (got %)', v_postgres_bypassrls;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') INTO v_service_role_exists;
  IF NOT v_service_role_exists THEN
    RAISE EXCEPTION 'Preflight failed: role service_role does not exist on this project';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_users_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'users' AND a.attname = 'id' AND a.attnum > 0;

  IF v_users_id_type IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: auth.users.id column not found';
  ELSIF v_users_id_type <> 'uuid' THEN
    RAISE EXCEPTION 'Preflight failed: auth.users.id is type % (expected uuid)', v_users_id_type;
  END IF;

  -- gen_random_uuid() is built into Postgres 13+ (pg_catalog, no extension
  -- required); confirm it is actually callable here rather than assuming.
  SELECT gen_random_uuid() INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: gen_random_uuid() did not return a value';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_members'
  ) INTO v_members_table_exists;

  IF v_members_table_exists THEN
    RAISE EXCEPTION 'Preflight failed: public.launch_cohort_members already exists — this migration only supports first-time creation. Investigate before re-running (see header note on repeatability).';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_emails'
  ) INTO v_emails_table_exists;

  IF v_emails_table_exists THEN
    RAISE EXCEPTION 'Preflight failed: public.launch_cohort_emails already exists — this migration only supports first-time creation. Investigate before re-running (see header note on repeatability).';
  END IF;

  RAISE NOTICE 'Preflight passed: all migration preconditions verified.';
END
$launch_cohort_migration_preflight$;

-- ---- snapshot existing policies/tables after preflight but before the
-- migration body runs, via GUCs (never a temp table) ----
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
  PERFORM set_config('launch_cohort_dry_run.policies_before', v_snapshot, true);

  PERFORM set_config('launch_cohort_dry_run.table_count_before',
    (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'), true);
END
$capture_policies_before$;

-- ---------------------------------------------------------------------
-- A. public.launch_cohort_members — the enrollment roster. Exactly the
-- rows Alberto inserts by hand (Step 4 of the runbook) after reviewing
-- each candidate in the Dashboard. Deleting the Auth user cascades
-- automatically (ON DELETE CASCADE), so a deleted account's enrollment
-- row disappears without any application-level cleanup step.
-- ---------------------------------------------------------------------
CREATE TABLE public.launch_cohort_members (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enrolled_at          timestamptz NOT NULL DEFAULT now(),
  enrolled_by          text NOT NULL,
  suppressed_at        timestamptz,
  suppression_reason   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT launch_cohort_members_enrolled_by_not_blank
    CHECK (btrim(enrolled_by) <> '')
);

COMMENT ON TABLE public.launch_cohort_members IS
  'Manually-curated roster for the one-time launch cohort email campaign (lib/launch-cohort/). Populated only via lib/security/launch_cohort_runbook.sql Step 4 (Alberto, after Dashboard review) — the application has no INSERT grant on this table and can never enroll anyone itself. service_role-only read/suppress access; no authenticated/anon access.';

-- ---------------------------------------------------------------------
-- B. public.launch_cohort_emails — one row per (enrolled user, email
-- type), mirroring public.lifecycle_emails' schema field-for-field. RLS
-- enabled with zero policies, and explicit REVOKE/GRANT so access is
-- never left to an ambient/default privilege. service_role is included in
-- every REVOKE ALL below (not just PUBLIC/anon/authenticated) because
-- Supabase's platform-level default privileges grant service_role ALL
-- PRIVILEGES on every new public-schema table automatically — omitting it
-- here is exactly what caused a production incident on lifecycle_emails
-- ($assert_grants$ failing with "service_role unexpectedly has DELETE").
-- ---------------------------------------------------------------------
CREATE TABLE public.launch_cohort_emails (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type           text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  eligible_at          timestamptz NOT NULL,
  attempt_count        integer NOT NULL DEFAULT 0,
  last_attempt_at      timestamptz,
  next_attempt_at      timestamptz,
  locked_until         timestamptz,
  claim_token          uuid,
  sent_at              timestamptz,
  provider_message_id  text,
  last_error           text,
  suppressed_at        timestamptz,
  suppression_reason   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT launch_cohort_emails_email_type_check
    CHECK (email_type IN ('welcome', 'story', 'routine', 'checkin')),
  CONSTRAINT launch_cohort_emails_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'suppressed', 'exhausted')),
  CONSTRAINT launch_cohort_emails_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  -- The one hard guarantee this whole feature rests on: at most one row
  -- per user per email type, ever.
  CONSTRAINT launch_cohort_emails_user_type_unique
    UNIQUE (user_id, email_type)
);

COMMENT ON TABLE public.launch_cohort_emails IS
  'Operational state for the one-time launch cohort email sequence (welcome, story, routine, checkin). service_role-only; no authenticated/anon access. See lib/launch-cohort/ for the application-layer service that reads and writes this table via public.claim_launch_cohort_email()/public.complete_launch_cohort_email().';

-- Supports the cron's discovery query: "rows that are not yet in a
-- terminal state and are due now or overdue". Partial index keeps it
-- small and fast even as sent/exhausted/suppressed rows accumulate.
CREATE INDEX launch_cohort_emails_pending_lookup_idx
  ON public.launch_cohort_emails (eligible_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX launch_cohort_emails_user_id_idx
  ON public.launch_cohort_emails (user_id);

ALTER TABLE public.launch_cohort_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_cohort_emails ENABLE ROW LEVEL SECURITY;
-- Deliberately NOT forced (FORCE ROW LEVEL SECURITY) on either table —
-- consistent with every existing FlowTrack table (see
-- migration_mfa_enforcement.sql preflight, which requires FORCE RLS =
-- false); postgres owns both tables and already bypasses RLS as owner
-- regardless.

-- Members roster: service_role may only SELECT (read the approved roster
-- to drive enrollment-sync) and UPDATE (record a manual STOP
-- suppression) — deliberately NO INSERT and NO DELETE, so the running
-- application can never add or remove a roster row itself. Enrollment is
-- exclusively a human, out-of-band action (Step 4 of the runbook, run as
-- postgres in the SQL Editor).
REVOKE ALL ON TABLE public.launch_cohort_members FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.launch_cohort_members TO service_role;

-- Per-email send state: service_role needs SELECT/INSERT/UPDATE directly
-- (the ensure-rows step upserts new pending rows; the claim/complete RPCs
-- below handle the state-transition writes; suppression is a direct
-- UPDATE) — no DELETE grant: rows are never deleted by the application,
-- only by the auth.users FK cascade.
REVOKE ALL ON TABLE public.launch_cohort_emails FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.launch_cohort_emails TO service_role;

-- ---------------------------------------------------------------------
-- C. public.claim_launch_cohort_email(): atomic claim/lease, identical
-- mechanism to public.claim_lifecycle_email() — a single
-- UPDATE ... WHERE ... RETURNING statement is how the atomicity is
-- achieved. A stale claim (status = 'processing' but locked_until has
-- passed — e.g. a crashed worker) is reclaimable by the same WHERE clause
-- once its lease has expired. SECURITY DEFINER + fixed empty search_path
-- per this repo's function privilege convention; owned by postgres.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_launch_cohort_email(
  p_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (id uuid, user_id uuid, email_type text, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'claim_launch_cohort_email: p_lease_seconds must be positive (got %)', p_lease_seconds;
  END IF;

  RETURN QUERY
  UPDATE public.launch_cohort_emails lce
  SET status          = 'processing',
      claim_token     = v_token,
      locked_until    = now() + make_interval(secs => p_lease_seconds),
      attempt_count   = lce.attempt_count + 1,
      last_attempt_at = now(),
      updated_at      = now()
  WHERE lce.id = p_id
    AND lce.suppressed_at IS NULL
    AND lce.status NOT IN ('sent', 'exhausted', 'suppressed')
    AND lce.eligible_at <= now()
    AND (lce.next_attempt_at IS NULL OR lce.next_attempt_at <= now())
    AND (lce.locked_until IS NULL OR lce.locked_until < now())
  RETURNING lce.id, lce.user_id, lce.email_type, lce.claim_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_launch_cohort_email(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_launch_cohort_email(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------
-- D. public.complete_launch_cohort_email(): the only way a 'processing'
-- row can be moved to a terminal-for-this-attempt state, and only by the
-- worker holding the matching claim_token — identical mechanism to
-- public.complete_lifecycle_email(). Backoff scheduling (next_attempt_at)
-- is computed in application code (lib/launch-cohort/eligibility.ts),
-- not here — this function only records whatever the caller already
-- decided.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_launch_cohort_email(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_last_error text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row_count integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'exhausted') THEN
    RAISE EXCEPTION 'complete_launch_cohort_email: invalid status % (expected sent, failed, or exhausted)', p_status;
  END IF;

  UPDATE public.launch_cohort_emails lce
  SET status               = p_status,
      sent_at              = CASE WHEN p_status = 'sent' THEN now() ELSE lce.sent_at END,
      provider_message_id  = CASE WHEN p_status = 'sent' THEN p_provider_message_id ELSE lce.provider_message_id END,
      last_error           = CASE WHEN p_status IN ('failed', 'exhausted') THEN p_last_error ELSE lce.last_error END,
      next_attempt_at      = CASE WHEN p_status = 'failed' THEN p_next_attempt_at ELSE NULL END,
      claim_token          = NULL,
      locked_until         = NULL,
      updated_at           = now()
  WHERE lce.id = p_id
    AND lce.claim_token = p_claim_token
    AND lce.status = 'processing';

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz) TO service_role;

-- ---- assertions: table shape ----
DO $assert_table_shape$
DECLARE
  v_members_col_count integer;
  v_emails_col_count integer;
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_policy_count integer;
BEGIN
  SELECT count(*) INTO v_members_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'launch_cohort_members';
  IF v_members_col_count <> 7 THEN
    RAISE EXCEPTION 'Assertion failed: expected 7 columns on public.launch_cohort_members, found %', v_members_col_count;
  END IF;

  SELECT count(*) INTO v_emails_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'launch_cohort_emails';
  IF v_emails_col_count <> 17 THEN
    RAISE EXCEPTION 'Assertion failed: expected 17 columns on public.launch_cohort_emails, found %', v_emails_col_count;
  END IF;

  FOR v_rls_enabled, v_rls_forced IN
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname IN ('launch_cohort_members', 'launch_cohort_emails')
  LOOP
    IF NOT v_rls_enabled THEN
      RAISE EXCEPTION 'Assertion failed: RLS not enabled on a launch_cohort table';
    END IF;
    IF v_rls_forced THEN
      RAISE EXCEPTION 'Assertion failed: FORCE RLS is enabled on a launch_cohort table (expected false)';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('launch_cohort_members', 'launch_cohort_emails');
  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: expected zero policies on the launch_cohort tables, found %', v_policy_count;
  END IF;

  RAISE NOTICE 'Assertion passed: table shape, RLS enabled/not forced, zero policies on both tables.';
END
$assert_table_shape$;

-- ---- assertions: grants (all seven relevant table privileges checked
-- explicitly for both tables, plus a direct catalog/ACL check that PUBLIC
-- has no entry at all — IF EXISTS(...), never a scalar SELECT INTO) ----
DO $assert_grants$
DECLARE
  v_priv text;
  v_all_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_members_allowed_privs text[] := ARRAY['SELECT', 'UPDATE'];
  v_members_forbidden_privs text[] := ARRAY['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_emails_allowed_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE'];
  v_emails_forbidden_privs text[] := ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
BEGIN
  FOREACH v_priv IN ARRAY v_members_allowed_privs LOOP
    IF NOT has_table_privilege('service_role', 'public.launch_cohort_members', v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role missing expected privilege % on launch_cohort_members', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY v_members_forbidden_privs LOOP
    IF has_table_privilege('service_role', 'public.launch_cohort_members', v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role unexpectedly has privilege % on launch_cohort_members', v_priv;
    END IF;
  END LOOP;

  FOREACH v_priv IN ARRAY v_emails_allowed_privs LOOP
    IF NOT has_table_privilege('service_role', 'public.launch_cohort_emails', v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role missing expected privilege % on launch_cohort_emails', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY v_emails_forbidden_privs LOOP
    IF has_table_privilege('service_role', 'public.launch_cohort_emails', v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role unexpectedly has privilege % on launch_cohort_emails', v_priv;
    END IF;
  END LOOP;

  FOREACH v_priv IN ARRAY v_all_privs LOOP
    IF has_table_privilege('anon', 'public.launch_cohort_members', v_priv)
       OR has_table_privilege('authenticated', 'public.launch_cohort_members', v_priv)
       OR has_table_privilege('anon', 'public.launch_cohort_emails', v_priv)
       OR has_table_privilege('authenticated', 'public.launch_cohort_emails', v_priv)
    THEN
      RAISE EXCEPTION 'Assertion failed: anon/authenticated unexpectedly has table privilege %', v_priv;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL
      aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('launch_cohort_members', 'launch_cohort_emails')
      AND c.relkind = 'r'
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Assertion failed: PUBLIC has a privilege on a launch_cohort table, expected zero';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion failed: service_role cannot execute claim_launch_cohort_email';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion failed: service_role cannot execute complete_launch_cohort_email';
  END IF;

  IF has_function_privilege('anon', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Assertion failed: anon/authenticated can execute a launch_cohort function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'public'
      AND p.oid IN (
        to_regprocedure('public.claim_launch_cohort_email(uuid, integer)'),
        to_regprocedure('public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz)')
      )
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Assertion failed: PUBLIC has an EXECUTE ACL entry on a launch_cohort function, expected zero';
  END IF;

  RAISE NOTICE 'Assertion passed: service_role has exactly the intended privileges on both tables and EXECUTE on both functions; anon/authenticated/PUBLIC have zero access, verified against all seven table privilege types and the raw ACL catalog.';
END
$assert_grants$;

-- ---- assertions: FK integrity on both tables (proves referential
-- integrity without fabricating a user) ----
DO $assert_fk_rejects_fake_user$
DECLARE
  v_emails_rejected boolean := false;
  v_members_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.launch_cohort_emails (user_id, email_type, eligible_at)
    VALUES (gen_random_uuid(), 'welcome', now());
  EXCEPTION WHEN foreign_key_violation THEN
    v_emails_rejected := true;
  END;
  IF NOT v_emails_rejected THEN
    RAISE EXCEPTION 'Assertion failed: inserting a launch_cohort_emails row with a nonexistent user_id did not raise a foreign_key_violation';
  END IF;

  BEGIN
    INSERT INTO public.launch_cohort_members (user_id, enrolled_by)
    VALUES (gen_random_uuid(), 'dry_run_probe');
  EXCEPTION WHEN foreign_key_violation THEN
    v_members_rejected := true;
  END;
  IF NOT v_members_rejected THEN
    RAISE EXCEPTION 'Assertion failed: inserting a launch_cohort_members row with a nonexistent user_id did not raise a foreign_key_violation';
  END IF;

  RAISE NOTICE 'Assertion passed: FK to auth.users(id) correctly rejects a nonexistent user_id on both tables.';
END
$assert_fk_rejects_fake_user$;

-- ---- assertions: launch_cohort_members.enrolled_by cannot be blank ----
DO $assert_enrolled_by_not_blank$
DECLARE
  v_user_id uuid;
  v_rejected boolean := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped enrolled_by-not-blank test: auth.users has zero rows to reference.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.launch_cohort_members (user_id, enrolled_by) VALUES (v_user_id, '   ');
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Assertion failed: a blank enrolled_by value was accepted';
  END IF;

  RAISE NOTICE 'Assertion passed: launch_cohort_members_enrolled_by_not_blank correctly rejects a blank value.';
END
$assert_enrolled_by_not_blank$;

-- ---- assertions: UNIQUE(user_id, email_type) is enforced (uses the same
-- read-only existing auth.users row; never prints its UUID/email) ----
DO $assert_unique_constraint$
DECLARE
  v_user_id uuid;
  v_duplicate_rejected boolean := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped unique-constraint test: auth.users has zero rows to reference.';
    RETURN;
  END IF;

  INSERT INTO public.launch_cohort_emails (user_id, email_type, eligible_at)
  VALUES (v_user_id, 'routine', now() + interval '14 days');

  BEGIN
    INSERT INTO public.launch_cohort_emails (user_id, email_type, eligible_at)
    VALUES (v_user_id, 'routine', now() + interval '14 days');
  EXCEPTION WHEN unique_violation THEN
    v_duplicate_rejected := true;
  END;

  IF NOT v_duplicate_rejected THEN
    RAISE EXCEPTION 'Assertion failed: a duplicate (user_id, email_type) insert was accepted instead of raising unique_violation';
  END IF;

  RAISE NOTICE 'Assertion passed: UNIQUE(user_id, email_type) correctly rejects a duplicate row for the same user and email_type.';
END
$assert_unique_constraint$;

-- ---- functional test: claim/complete lifecycle, using one REAL existing
-- auth.users row if any exists (read-only SELECT; never fabricates a
-- user; its UUID/email is never printed; the whole surrounding
-- transaction is rolled back at the very end, so this INSERT never
-- persists). Uses email_type 'welcome'. ----
DO $functional_claim_complete_test$
DECLARE
  v_user_id uuid;
  v_row_id uuid;
  v_first_claim record;
  v_second_claim_count integer;
  v_wrong_token_result boolean;
  v_right_token_result boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped functional claim/complete test: auth.users has zero rows to reference.';
    RETURN;
  END IF;

  INSERT INTO public.launch_cohort_emails (user_id, email_type, eligible_at)
  VALUES (v_user_id, 'welcome', now() - interval '1 minute')
  RETURNING id INTO v_row_id;

  SELECT * INTO v_first_claim FROM public.claim_launch_cohort_email(v_row_id, 120);
  IF v_first_claim.id IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: first claim on a fresh pending row returned no rows';
  END IF;

  -- Single-session analogue of true concurrency, not a genuine
  -- two-connection concurrency test; see the runbook header note.
  SELECT count(*) INTO v_second_claim_count FROM public.claim_launch_cohort_email(v_row_id, 120);
  IF v_second_claim_count <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: a second claim on an already-claimed, non-expired row succeeded (expected 0 rows)';
  END IF;

  v_wrong_token_result := public.complete_launch_cohort_email(v_row_id, gen_random_uuid(), 'sent');
  IF v_wrong_token_result THEN
    RAISE EXCEPTION 'Assertion failed: complete_launch_cohort_email accepted a mismatched claim_token';
  END IF;

  v_right_token_result := public.complete_launch_cohort_email(v_row_id, v_first_claim.claim_token, 'sent', 'test_provider_msg_id');
  IF NOT v_right_token_result THEN
    RAISE EXCEPTION 'Assertion failed: complete_launch_cohort_email rejected the correct claim_token';
  END IF;

  PERFORM 1 FROM public.launch_cohort_emails
  WHERE id = v_row_id AND status = 'sent' AND sent_at IS NOT NULL AND claim_token IS NULL AND locked_until IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assertion failed: row was not left in the expected post-sent state';
  END IF;

  RAISE NOTICE 'Assertion passed: claim/complete atomicity and claim-token enforcement behave as designed.';
END
$functional_claim_complete_test$;

-- ---- assertions: service_role can actually execute both RPCs (not just
-- catalog-privilege-checked), a stale/expired lease is reclaimable, AND
-- service_role genuinely cannot INSERT into launch_cohort_members (the
-- "application can never enroll anyone itself" guarantee). Uses
-- email_type 'story' for the same read-only existing user. ----
DO $assert_service_role_execution$
DECLARE
  v_user_id uuid;
  v_row_id uuid;
  v_can_assume_service_role boolean;
  v_claim record;
  v_complete_result boolean;
  v_members_insert_rejected boolean := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped service-role execution test: auth.users has zero rows to reference.';
    RETURN;
  END IF;

  v_can_assume_service_role := pg_has_role(current_user, 'service_role', 'MEMBER');
  IF NOT v_can_assume_service_role THEN
    RAISE EXCEPTION 'Assertion failed: current_user % cannot SET ROLE service_role — the actual service-role execution path cannot be proven', current_user;
  END IF;

  INSERT INTO public.launch_cohort_emails (user_id, email_type, eligible_at, status, claim_token, locked_until, attempt_count)
  VALUES (v_user_id, 'story', now() - interval '1 minute', 'processing', gen_random_uuid(), now() - interval '10 minutes', 1)
  RETURNING id INTO v_row_id;

  BEGIN
    SET LOCAL ROLE service_role;

    SELECT * INTO v_claim FROM public.claim_launch_cohort_email(v_row_id, 120);
    IF v_claim.id IS NULL THEN
      RAISE EXCEPTION 'Assertion failed: service_role could not reclaim the stale story row';
    END IF;

    v_complete_result := public.complete_launch_cohort_email(v_row_id, v_claim.claim_token, 'sent', 'test_provider_msg_id_service_role');
    IF NOT v_complete_result THEN
      RAISE EXCEPTION 'Assertion failed: service_role could not complete the story row it just claimed';
    END IF;

    BEGIN
      INSERT INTO public.launch_cohort_members (user_id, enrolled_by) VALUES (v_user_id, 'service_role_probe');
    EXCEPTION WHEN insufficient_privilege THEN
      v_members_insert_rejected := true;
    END;

    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;

  IF NOT v_members_insert_rejected THEN
    RAISE EXCEPTION 'Assertion failed: service_role was able to INSERT into launch_cohort_members — enrollment must be human-only';
  END IF;

  PERFORM 1 FROM public.launch_cohort_emails
  WHERE id = v_row_id AND status = 'sent' AND sent_at IS NOT NULL AND claim_token IS NULL AND locked_until IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assertion failed: story row was not left in the expected post-sent state after service_role execution';
  END IF;

  RAISE NOTICE 'Assertion passed: service_role actually claimed and completed a stale launch_cohort_emails row end-to-end under SET LOCAL ROLE, and was correctly denied INSERT on launch_cohort_members.';
END
$assert_service_role_execution$;

-- ---- assertions: existing policies/tables unchanged ----
DO $assert_existing_unchanged$
DECLARE
  v_after text;
  v_table_count_after text;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.tablename, t.policyname)::text, '[]')
  INTO v_after
  FROM (
    SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename NOT IN ('launch_cohort_members', 'launch_cohort_emails')
  ) t;

  IF v_after IS DISTINCT FROM current_setting('launch_cohort_dry_run.policies_before', true) THEN
    RAISE EXCEPTION 'Assertion failed: an existing policy (outside the two new tables) changed during this dry run';
  END IF;

  SELECT (count(*) - 2)::text INTO v_table_count_after -- subtract the two new tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r';

  IF v_table_count_after IS DISTINCT FROM current_setting('launch_cohort_dry_run.table_count_before', true) THEN
    RAISE EXCEPTION 'Assertion failed: an unexpected table count change beyond the two new tables';
  END IF;

  RAISE NOTICE 'Assertion passed: no existing table or policy was altered by this dry run.';
END
$assert_existing_unchanged$;

ROLLBACK;

-- Final status: confirms the rollback actually restored the exact
-- pre-transaction state — six separately named boolean columns, each
-- independently checkable, against the Step 0 baseline (11 tables, 25
-- policies — lifecycle_emails already live).
SELECT
  NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_members'
  ) AS launch_cohort_members_absent,
  NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'launch_cohort_emails'
  ) AS launch_cohort_emails_absent,
  to_regprocedure('public.claim_launch_cohort_email(uuid, integer)') IS NULL
    AS claim_launch_cohort_email_absent,
  to_regprocedure('public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz)') IS NULL
    AS complete_launch_cohort_email_absent,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r') = 11
    AS public_table_count_matches_baseline_11,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') = 25
    AS public_policy_count_matches_baseline_25;
-- expect: true, true, true, true, true, true


-- =======================================================================
-- STEP 2: Real migration
-- =======================================================================
-- Run lib/security/migration_launch_cohort.sql in full, exactly as
-- written (it has its own BEGIN...COMMIT). Not executed by this runbook.


-- =======================================================================
-- STEP 3: Post-migration verification (read-only)
-- =======================================================================

SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'launch_cohort_members'; -- expect: 7

SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'launch_cohort_emails'; -- expect: 17

SELECT count(*) FROM pg_policies WHERE schemaname = 'public'; -- expect: still 25 (unchanged)

SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname IN ('launch_cohort_members', 'launch_cohort_emails');
-- expect: true, false for both rows

SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('launch_cohort_members', 'launch_cohort_emails')
ORDER BY table_name, grantee, privilege_type;
-- expect: only service_role rows — SELECT/UPDATE for launch_cohort_members,
-- SELECT/INSERT/UPDATE for launch_cohort_emails

SELECT has_function_privilege('service_role', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE'),
       has_function_privilege('anon', 'public.claim_launch_cohort_email(uuid, integer)', 'EXECUTE');
-- expect: true, false, false

SELECT count(*) AS enrolled_members_count FROM public.launch_cohort_members; -- expect: 0 (Step 4 not yet run)


-- =======================================================================
-- STEP 4: Manual roster enrollment (Alberto only — run after Dashboard
-- review; do not run against production before the real migration in
-- Step 2 has been applied)
-- =======================================================================
-- For each approved external cohort member, resolve their exact
-- auth.users.id via Supabase Dashboard > Authentication > Users — search
-- by the name/email you already have out-of-band; this SQL never resolves
-- anyone by email itself. Substitute every <...> placeholder below with a
-- real value before running. NEVER commit a filled-in version of this
-- block to source control — copy it to a scratch file or paste it
-- directly into the SQL Editor instead.
--
-- Enroll only the users you have explicitly approved. If two accounts
-- exist for the same person (a known situation for one of the approved
-- names in this cohort), enroll only the one you have confirmed is the
-- correct, current account — resolved by you in the Dashboard, never
-- guessed here.
INSERT INTO public.launch_cohort_members (user_id, enrolled_by)
VALUES
  ('<uuid-for-approved-user-1>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-2>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-3>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-4>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-5>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-6>', 'alberto_manual_review_<date>'),
  ('<uuid-for-approved-user-7>', 'alberto_manual_review_<date>')
  -- add or remove lines so the list matches exactly the approved cohort —
  -- nothing more, nothing less.
ON CONFLICT (user_id) DO NOTHING;

-- Verify exactly the intended roster (and nothing else) was enrolled.
-- Cross-check the row count and each user_id against your own approved
-- list out-of-band before proceeding to configure LAUNCH_COHORT_START_AT.
SELECT user_id, enrolled_at, enrolled_by FROM public.launch_cohort_members ORDER BY enrolled_at;


-- =======================================================================
-- STEP 5: Narrow rollback
-- =======================================================================
-- Removes only the objects this migration added. Does not touch
-- auth.users, auth.mfa_factors, any Phase 1C policy, lifecycle_emails, or
-- any other existing table/function/row. Enrolled roster rows are removed
-- automatically as part of dropping launch_cohort_members.

BEGIN;
DROP FUNCTION IF EXISTS public.claim_launch_cohort_email(uuid, integer);
DROP FUNCTION IF EXISTS public.complete_launch_cohort_email(uuid, uuid, text, text, text, timestamptz);
DROP TABLE IF EXISTS public.launch_cohort_emails;
DROP TABLE IF EXISTS public.launch_cohort_members;
COMMIT;

-- Post-rollback check:
SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('launch_cohort_members', 'launch_cohort_emails')
) AS any_launch_cohort_table_exists_after_narrow_rollback; -- expect: false

SELECT count(*) FROM pg_policies WHERE schemaname = 'public'; -- expect: still 25


-- =======================================================================
-- APPENDIX: Manual STOP suppression (deliberate, per-user, never by
-- email)
-- =======================================================================
-- When a cohort member replies STOP to any launch-cohort email, Alberto:
--   1. Resolves that exact user's UUID deliberately — via the Supabase
--      Dashboard's Authentication > Users search, confirming the one
--      exact email address that sent the STOP reply, and copying that
--      row's UUID. Never resolved by an automated/ambiguous email match.
--   2. Runs the parameterized statements below with that UUID
--      substituted in — never a bare email address.
--
-- Suppresses every not-yet-sent launch_cohort_emails row for this user
-- (never re-sends an already-sent email):
UPDATE public.launch_cohort_emails
SET status = 'suppressed',
    suppressed_at = now(),
    suppression_reason = 'user_replied_stop',
    updated_at = now()
WHERE user_id = '<paste-the-verified-uuid-here>'
  AND status NOT IN ('sent', 'suppressed');

-- Also marks the roster row itself, so a future re-run of the
-- enrollment-sync step can never recreate rows for this member:
UPDATE public.launch_cohort_members
SET suppressed_at = now(),
    suppression_reason = 'user_replied_stop',
    updated_at = now()
WHERE user_id = '<paste-the-verified-uuid-here>';

-- The equivalent application-layer function
-- (lib/launch-cohort/service.ts: suppressUpcomingLaunchCohortEmails)
-- takes the same UUID-only parameter and is covered by
-- lib/launch-cohort/service.test.ts, for future wiring into an internal
-- tool — no public/unauthenticated endpoint is created in this phase, and
-- no inbound-email automation is built: STOP replies are still read and
-- processed by a human, exactly like the existing lifecycle-emails
-- appendix.
