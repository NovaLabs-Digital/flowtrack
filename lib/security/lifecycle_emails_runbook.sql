-- FlowTrack: signup lifecycle emails — dry run, verification, and rollback
-- runbook. Companion to lib/security/migration_lifecycle_emails.sql.
--
-- NOTHING IN THIS FILE HAS BEEN EXECUTED. Alberto runs each step manually
-- in the Supabase SQL Editor, in order, reading the output at each step
-- before proceeding.
--
-- Lesson carried over from Security Phase 1C (see mfa_enforcement_runbook.sql):
-- a bare CREATE TEMP TABLE, later referenced by name (including via
-- %ROWTYPE) from a SEPARATE top-level statement in the same SQL Editor
-- batch, can fail with 42P01 even though the object was just created — a
-- Supabase SQL Editor same-batch name-resolution quirk specific to TEMP
-- tables. This runbook therefore uses set_config()/current_setting() GUCs
-- for every "snapshot now, compare later" check, exactly like the
-- corrected Phase 1C runbook, and creates no temp table anywhere. Ordinary
-- permanent objects (the real migration's CREATE TABLE/CREATE FUNCTION)
-- are unaffected by this quirk — migration_mfa_enforcement.sql already
-- proved that in production for an analogous CREATE FUNCTION + later
-- reference in the same file.
--
-- KNOWN LIMITATION — provider idempotency-key retention window:
-- lib/lifecycle-emails/eligibility.ts's buildLifecycleEmailIdempotencyKey()
-- produces a stable key per lifecycle_emails row (flowtrack-lifecycle-
-- email/<id>), used on every attempt/retry of that row. Resend's own
-- documentation (https://resend.com/docs/dashboard/emails/idempotency-keys)
-- states idempotency keys are stored for 24 hours from first use, not
-- indefinitely. Precisely: if Resend accepts a message but FlowTrack loses
-- the response (network error, process crash, etc.) before recording
-- success, and the row is then retried after that 24-hour window has
-- passed, the provider key alone can no longer guarantee suppression of
-- the duplicate send — this is not unconditional exactly-once delivery,
-- and this runbook does not claim it is.
--
-- CRON CADENCE — RESOLVED: Nova Labs Digital is on Vercel Pro, and
-- vercel.json now schedules /api/cron/signup-emails at "17 */6 * * *"
-- (00:17, 06:17, 12:17, 18:17 UTC), alongside the pre-existing
-- /api/cron/bill-reminders daily job — Pro's per-minute-accurate cron
-- scheduling supports this cadence, unlike Hobby's daily-only grantee.
--
-- With MAX_ATTEMPTS = 4 and backoff steps of 15m / 60m / 6h (see
-- lib/lifecycle-emails/eligibility.ts), the last scheduled retry for a
-- given failure is only ~7.25 hours after the first attempt on its own,
-- and because the cron now runs every 6 hours rather than once daily, a
-- row becoming reclaimable at any point still gets picked up by the next
-- run within at most 6 hours — not up to a full day's wait. Combined,
-- every normal retry opportunity for a given send lands comfortably
-- within Resend's 24-hour idempotency-key window, not merely close to or
-- at its boundary.
--
-- This is still NOT an unconditional exactly-once guarantee: a missed
-- cron invocation, a Vercel/Supabase/Resend outage spanning multiple
-- scheduled runs, or a row's own attempt/backoff timing landing awkwardly
-- across an extended gap could still push an eventual retry past the
-- 24-hour window in an unusual case. The idempotency key remains a
-- second layer of defense (the atomic claim/claim-token check in
-- public.claim_lifecycle_email()/public.complete_lifecycle_email() is the
-- primary one, and does not depend on the 24-hour window at all) — this
-- section documents the residual provider-side risk honestly rather than
-- claiming it away.

-- =======================================================================
-- STEP 0: Baseline inventory (read-only, no transaction needed)
-- =======================================================================
-- Run this first and keep its output. Confirms the starting state this
-- migration assumes.

SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'lifecycle_emails'
) AS lifecycle_emails_already_exists; -- expect: false

SELECT count(*) AS current_public_table_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'; -- record this number

SELECT count(*) AS current_policy_count FROM pg_policies WHERE schemaname = 'public';
-- expect: 25 (19 Phase 1A baseline + 6 Phase 1C mfa_required_if_enrolled_*)

SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('postgres', 'service_role', 'authenticated', 'anon');

SELECT count(*) AS existing_auth_users_count FROM auth.users; -- informational only


-- =======================================================================
-- STEP 1: Transactional dry run (rolled back — nothing persists)
-- =======================================================================
-- Paste and run this entire block as one execution. Ends in ROLLBACK, so
-- no table, function, grant, or row created here survives.
--
-- This dry run contains the COMPLETE migration body inline — the preflight
-- section immediately below is byte-for-byte identical to
-- lib/security/migration_lifecycle_emails.sql's own preflight, and the
-- table/index/RLS/grant/function section further below (after the GUC
-- snapshot) is byte-for-byte identical to that file's own body after its
-- preflight, excluding only that file's own leading and trailing
-- transaction-control statements (this dry run supplies its own instead,
-- with one GUC-snapshot step inserted between the preflight and the
-- body). There is exactly one copy of every migration statement and
-- exactly one preflight in this file — nothing here is a placeholder for
-- manual pasting.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preflight: fail loudly, before touching anything, unless every fact
-- this migration depends on is still true.
-- ---------------------------------------------------------------------
DO $lifecycle_emails_migration_preflight$
DECLARE
  v_postgres_bypassrls   boolean;
  v_service_role_exists  boolean;
  v_users_id_type        text;
  v_table_exists         boolean;
  v_probe                uuid;
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
    WHERE n.nspname = 'public' AND c.relname = 'lifecycle_emails'
  ) INTO v_table_exists;

  IF v_table_exists THEN
    RAISE EXCEPTION 'Preflight failed: public.lifecycle_emails already exists — this migration only supports first-time creation. Investigate before re-running (see header note on repeatability).';
  END IF;

  RAISE NOTICE 'Preflight passed: all migration preconditions verified.';
END
$lifecycle_emails_migration_preflight$;

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
  PERFORM set_config('lifecycle_dry_run.policies_before', v_snapshot, true);

  PERFORM set_config('lifecycle_dry_run.table_count_before',
    (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'), true);
END
$capture_policies_before$;

-- ---------------------------------------------------------------------
-- A. public.lifecycle_emails — one row per (user, email_type). Deleting a
-- user cascades automatically (ON DELETE CASCADE), so a deleted account's
-- rows disappear without any application-level cleanup step.
-- ---------------------------------------------------------------------
CREATE TABLE public.lifecycle_emails (
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

  CONSTRAINT lifecycle_emails_email_type_check
    CHECK (email_type IN ('welcome', 'feedback_48h', 'checkin_7d')),
  CONSTRAINT lifecycle_emails_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'suppressed', 'exhausted')),
  CONSTRAINT lifecycle_emails_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  -- The one hard guarantee this whole feature rests on: at most one row
  -- per user per email type, ever.
  CONSTRAINT lifecycle_emails_user_type_unique
    UNIQUE (user_id, email_type)
);

COMMENT ON TABLE public.lifecycle_emails IS
  'Operational state for the signup lifecycle email sequence (welcome, feedback_48h, checkin_7d). service_role-only; no authenticated/anon access. See lib/lifecycle-emails/ for the application-layer service that reads and writes this table via public.claim_lifecycle_email()/public.complete_lifecycle_email().';

-- Supports the cron/immediate-endpoint discovery query: "rows that are not
-- yet in a terminal state and are due now or overdue". Partial index keeps
-- it small and fast even as sent/exhausted/suppressed rows accumulate.
CREATE INDEX lifecycle_emails_pending_lookup_idx
  ON public.lifecycle_emails (eligible_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX lifecycle_emails_user_id_idx
  ON public.lifecycle_emails (user_id);

-- ---------------------------------------------------------------------
-- B. RLS + grants: enabled with zero policies (default-deny for every
-- role except the table owner and any role with BYPASSRLS), and explicit
-- REVOKE/GRANT so access is never left to an ambient/default privilege.
-- service_role bypasses RLS by Supabase's own platform design (the same
-- fact already relied on by every cron/webhook route in this project —
-- see migration_mfa_enforcement.sql's header note), so it needs the table
-- grants below but no policy.
-- ---------------------------------------------------------------------
ALTER TABLE public.lifecycle_emails ENABLE ROW LEVEL SECURITY;
-- Deliberately NOT forced (FORCE ROW LEVEL SECURITY) — consistent with
-- every existing FlowTrack table (see migration_mfa_enforcement.sql
-- preflight, which requires FORCE RLS = false); postgres owns this table
-- and already bypasses RLS as owner regardless.

REVOKE ALL ON TABLE public.lifecycle_emails FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lifecycle_emails TO service_role;
-- No DELETE grant: rows are never deleted by the application, only by the
-- auth.users FK cascade. No grant to authenticated/anon at all — this is
-- purely operational infrastructure, never exposed to end users.
--
-- service_role is included in the REVOKE ALL above (not just
-- PUBLIC/anon/authenticated) because Supabase's platform-level default
-- privileges grant service_role ALL PRIVILEGES on every new table in the
-- public schema automatically (a project-wide default this repo's
-- migrations do not control). Without revoking from service_role first,
-- that default ALL — including DELETE, TRUNCATE, REFERENCES, and
-- TRIGGER — would silently survive underneath the GRANT SELECT, INSERT,
-- UPDATE below, since GRANT only ever adds privileges, never removes
-- ones a role already has. This is exactly what the Step 1 dry run
-- caught in production: $assert_grants$ failed with "service_role
-- unexpectedly has DELETE" before this fix.

-- ---------------------------------------------------------------------
-- C. public.claim_lifecycle_email(): atomic claim/lease. A single
-- UPDATE ... WHERE ... RETURNING statement is how the atomicity is
-- achieved — Postgres's row-level locking means two concurrent callers
-- targeting the same row can never both see it satisfy the WHERE clause
-- and succeed; the second caller's statement waits for the first's
-- transaction to commit, then re-evaluates the WHERE clause against the
-- now-'processing' row and affects zero rows. A stale claim (status =
-- 'processing' but locked_until has passed — e.g. a crashed worker) is
-- reclaimable by the same WHERE clause once its lease has expired.
-- SECURITY DEFINER + fixed empty search_path per this repo's function
-- privilege convention; owned by postgres.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_lifecycle_email(
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
    RAISE EXCEPTION 'claim_lifecycle_email: p_lease_seconds must be positive (got %)', p_lease_seconds;
  END IF;

  RETURN QUERY
  UPDATE public.lifecycle_emails le
  SET status          = 'processing',
      claim_token     = v_token,
      locked_until    = now() + make_interval(secs => p_lease_seconds),
      attempt_count   = le.attempt_count + 1,
      last_attempt_at = now(),
      updated_at      = now()
  WHERE le.id = p_id
    AND le.suppressed_at IS NULL
    AND le.status NOT IN ('sent', 'exhausted', 'suppressed')
    AND le.eligible_at <= now()
    AND (le.next_attempt_at IS NULL OR le.next_attempt_at <= now())
    AND (le.locked_until IS NULL OR le.locked_until < now())
  RETURNING le.id, le.user_id, le.email_type, le.claim_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_lifecycle_email(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_lifecycle_email(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------
-- D. public.complete_lifecycle_email(): the only way a 'processing' row
-- can be moved to a terminal-for-this-attempt state, and only by the
-- worker holding the matching claim_token — a worker whose lease already
-- expired and was reclaimed by someone else will find zero rows match
-- (its token no longer matches the current one) and gets `false` back,
-- rather than clobbering the newer claim's outcome. Backoff scheduling
-- (next_attempt_at) is computed in application code
-- (lib/lifecycle-emails/eligibility.ts:computeNextAttempt), not here —
-- this function only records whatever the caller already decided.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_lifecycle_email(
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
    RAISE EXCEPTION 'complete_lifecycle_email: invalid status % (expected sent, failed, or exhausted)', p_status;
  END IF;

  UPDATE public.lifecycle_emails le
  SET status               = p_status,
      sent_at              = CASE WHEN p_status = 'sent' THEN now() ELSE le.sent_at END,
      provider_message_id  = CASE WHEN p_status = 'sent' THEN p_provider_message_id ELSE le.provider_message_id END,
      last_error           = CASE WHEN p_status IN ('failed', 'exhausted') THEN p_last_error ELSE le.last_error END,
      next_attempt_at       = CASE WHEN p_status = 'failed' THEN p_next_attempt_at ELSE NULL END,
      claim_token          = NULL,
      locked_until         = NULL,
      updated_at           = now()
  WHERE le.id = p_id
    AND le.claim_token = p_claim_token
    AND le.status = 'processing';

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz) TO service_role;

-- ---- assertions: table shape ----
DO $assert_table_shape$
DECLARE
  v_col_count integer;
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_policy_count integer;
BEGIN
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'lifecycle_emails';
  IF v_col_count <> 17 THEN
    RAISE EXCEPTION 'Assertion failed: expected 17 columns on public.lifecycle_emails, found %', v_col_count;
  END IF;

  SELECT relrowsecurity, relforcerowsecurity INTO v_rls_enabled, v_rls_forced
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = 'lifecycle_emails';
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Assertion failed: RLS not enabled on public.lifecycle_emails';
  END IF;
  IF v_rls_forced THEN
    RAISE EXCEPTION 'Assertion failed: FORCE RLS is enabled (expected false)';
  END IF;

  SELECT count(*) INTO v_policy_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lifecycle_emails';
  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: expected zero policies on lifecycle_emails, found %', v_policy_count;
  END IF;

  RAISE NOTICE 'Assertion passed: table shape, RLS enabled/not forced, zero policies.';
END
$assert_table_shape$;

-- ---- assertions: grants (checks all seven relevant table privileges
-- explicitly — not just the three that are supposed to be granted — and
-- verifies PUBLIC has no ACL entry at all by reading the catalog's own
-- ACL representation via aclexplode(), rather than assuming that
-- has_table_privilege() checks against named roles are sufficient to
-- rule out a PUBLIC-level grant. The PUBLIC checks use IF EXISTS(...)
-- rather than SELECT ... INTO a scalar count variable: an earlier
-- version of this block used "SELECT count(*) INTO v_public_table_
-- acl_count FROM aclexplode(...) ... WHERE ..." and failed in production
-- with "relation \"v_public_table_acl_count\" does not exist" — the
-- INTO-clause form is ambiguous with plain SQL's legacy
-- "SELECT ... INTO tablename FROM ..." (CREATE-TABLE-AS shorthand), and
-- when that ambiguity resolves the wrong way, the plpgsql variable name
-- gets parsed as a target relation instead of a binding target.
-- IF EXISTS(...) has no INTO clause at all, so this ambiguity class
-- cannot arise. ----
DO $assert_grants$
DECLARE
  v_table text := 'public.lifecycle_emails';
  v_priv text;
  v_service_role_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE'];
  v_forbidden_service_role_privs text[] := ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_all_privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
BEGIN
  -- service_role: exactly SELECT, INSERT, UPDATE — nothing else.
  FOREACH v_priv IN ARRAY v_service_role_privs LOOP
    IF NOT has_table_privilege('service_role', v_table, v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role missing expected table privilege %', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY v_forbidden_service_role_privs LOOP
    IF has_table_privilege('service_role', v_table, v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: service_role unexpectedly has table privilege %', v_priv;
    END IF;
  END LOOP;

  -- anon/authenticated: none of the seven relevant privileges.
  FOREACH v_priv IN ARRAY v_all_privs LOOP
    IF has_table_privilege('anon', v_table, v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: anon unexpectedly has table privilege %', v_priv;
    END IF;
    IF has_table_privilege('authenticated', v_table, v_priv) THEN
      RAISE EXCEPTION 'Assertion failed: authenticated unexpectedly has table privilege %', v_priv;
    END IF;
  END LOOP;

  -- PUBLIC: no ACL entry at all on the table — read directly from
  -- pg_class.relacl via aclexplode(), where PUBLIC is represented as
  -- grantee = 0, instead of inferring PUBLIC's status from what named
  -- roles individually lack. acldefault('r', c.relowner) is the fallback
  -- Postgres itself would apply if relacl were ever NULL (no explicit
  -- ACL yet), so this check is correct even before any GRANT/REVOKE has
  -- run against the table.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL
      aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname = 'lifecycle_emails'
      AND c.relkind = 'r'
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Assertion failed: PUBLIC has a privilege on lifecycle_emails, expected zero';
  END IF;

  -- Functions: service_role can execute both; PUBLIC/anon/authenticated
  -- can execute neither.
  IF NOT has_function_privilege('service_role', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion failed: service_role cannot execute claim_lifecycle_email';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion failed: service_role cannot execute complete_lifecycle_email';
  END IF;

  IF has_function_privilege('anon', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Assertion failed: anon/authenticated can execute a lifecycle function';
  END IF;

  -- PUBLIC: no EXECUTE ACL entry on either function, read directly from
  -- pg_proc.proacl via aclexplode(), same rationale and same IF EXISTS(...)
  -- form as the table check above. Each check matches on p.oid =
  -- to_regprocedure('public.<fn>(<exact arg types>)') rather than
  -- p.proname alone, so it identifies exactly one signature — this
  -- matters because Postgres allows function overloading by argument
  -- list, and a bare proname match could silently include an unrelated
  -- same-named function with different arguments.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.claim_lifecycle_email(uuid, integer)')
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Assertion failed: PUBLIC can execute claim_lifecycle_email, expected zero';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL
      aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'public'
      AND p.oid = to_regprocedure('public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz)')
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Assertion failed: PUBLIC can execute complete_lifecycle_email, expected zero';
  END IF;

  RAISE NOTICE 'Assertion passed: service_role has exactly SELECT/INSERT/UPDATE (no DELETE/TRUNCATE/REFERENCES/TRIGGER) and EXECUTE on both functions; anon/authenticated/PUBLIC have zero table or function privileges, verified against all seven table privilege types and the raw ACL catalog.';
END
$assert_grants$;

-- ---- assertions: FK integrity (proves referential integrity without fabricating a user) ----
DO $assert_fk_rejects_fake_user$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.lifecycle_emails (user_id, email_type, eligible_at)
    VALUES (gen_random_uuid(), 'welcome', now());
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Assertion failed: inserting a lifecycle_emails row with a nonexistent user_id did not raise a foreign_key_violation';
  END IF;

  RAISE NOTICE 'Assertion passed: FK to auth.users(id) correctly rejects a nonexistent user_id.';
END
$assert_fk_rejects_fake_user$;

-- ---- assertions: UNIQUE(user_id, email_type) is enforced (uses the same
-- read-only existing auth.users row; never prints its UUID/email) ----
DO $assert_unique_constraint$
DECLARE
  v_user_id uuid;
  v_duplicate_rejected boolean := false;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped unique-constraint test: auth.users has zero rows to reference (nothing to verify against, nothing fabricated).';
    RETURN;
  END IF;

  INSERT INTO public.lifecycle_emails (user_id, email_type, eligible_at)
  VALUES (v_user_id, 'feedback_48h', now() + interval '1 day');

  BEGIN
    INSERT INTO public.lifecycle_emails (user_id, email_type, eligible_at)
    VALUES (v_user_id, 'feedback_48h', now() + interval '1 day');
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
-- auth.users row if any exists (read-only SELECT; never fabricates a user;
-- its UUID/email is never printed; the whole surrounding transaction is
-- rolled back at the very end, so this INSERT never persists). Skips
-- cleanly with a NOTICE if auth.users is currently empty. Uses email_type
-- 'welcome' and runs first among the functional row tests (welcome-first
-- ordering preserved). ----
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
    RAISE NOTICE 'Skipped functional claim/complete test: auth.users has zero rows to reference (nothing to verify against, nothing fabricated).';
    RETURN;
  END IF;

  INSERT INTO public.lifecycle_emails (user_id, email_type, eligible_at)
  VALUES (v_user_id, 'welcome', now() - interval '1 minute')
  RETURNING id INTO v_row_id;

  -- First claim: must succeed (row is pending and eligible).
  SELECT * INTO v_first_claim FROM public.claim_lifecycle_email(v_row_id, 120);
  IF v_first_claim.id IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: first claim on a fresh pending row returned no rows';
  END IF;

  -- Second claim attempt while the first's lease is still live: must
  -- return zero rows (proves the atomic exclusivity the WHERE clause
  -- provides — this is the single-session analogue of true concurrency,
  -- not a genuine two-connection concurrency test; see the runbook header
  -- note on scope).
  SELECT count(*) INTO v_second_claim_count FROM public.claim_lifecycle_email(v_row_id, 120);
  IF v_second_claim_count <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: a second claim on an already-claimed, non-expired row succeeded (expected 0 rows)';
  END IF;

  -- Wrong claim token: complete_lifecycle_email must refuse and return false.
  v_wrong_token_result := public.complete_lifecycle_email(v_row_id, gen_random_uuid(), 'sent');
  IF v_wrong_token_result THEN
    RAISE EXCEPTION 'Assertion failed: complete_lifecycle_email accepted a mismatched claim_token';
  END IF;

  -- Right claim token: must succeed and record sent_at/provider_message_id.
  v_right_token_result := public.complete_lifecycle_email(v_row_id, v_first_claim.claim_token, 'sent', 'test_provider_msg_id');
  IF NOT v_right_token_result THEN
    RAISE EXCEPTION 'Assertion failed: complete_lifecycle_email rejected the correct claim_token';
  END IF;

  PERFORM 1 FROM public.lifecycle_emails
  WHERE id = v_row_id AND status = 'sent' AND sent_at IS NOT NULL AND claim_token IS NULL AND locked_until IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assertion failed: row was not left in the expected post-sent state';
  END IF;

  RAISE NOTICE 'Assertion passed: claim/complete atomicity and claim-token enforcement behave as designed.';
END
$functional_claim_complete_test$;

-- ---- assertions: service_role can actually execute both RPCs (not just
-- catalog-privilege-checked), and a stale/expired lease is reclaimable.
-- Uses email_type 'checkin_7d' for the same read-only existing user, so
-- this row never collides with the 'welcome' or 'feedback_48h' rows used
-- above. UUID/email are never printed. ----
DO $assert_service_role_execution$
DECLARE
  v_user_id uuid;
  v_row_id uuid;
  v_can_assume_service_role boolean;
  v_claim record;
  v_complete_result boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Skipped service-role execution test: auth.users has zero rows to reference (nothing to verify against, nothing fabricated).';
    RETURN;
  END IF;

  v_can_assume_service_role := pg_has_role(current_user, 'service_role', 'MEMBER');
  IF NOT v_can_assume_service_role THEN
    RAISE EXCEPTION 'Assertion failed: current_user % cannot SET ROLE service_role — the actual service-role execution path cannot be proven', current_user;
  END IF;

  -- Manufacture a stale (expired-lease) processing row, exactly like a
  -- crashed worker would leave behind.
  INSERT INTO public.lifecycle_emails (user_id, email_type, eligible_at, status, claim_token, locked_until, attempt_count)
  VALUES (v_user_id, 'checkin_7d', now() - interval '1 minute', 'processing', gen_random_uuid(), now() - interval '10 minutes', 1)
  RETURNING id INTO v_row_id;

  BEGIN
    SET LOCAL ROLE service_role;

    -- Actually reclaims the stale row while genuinely running as
    -- service_role (not postgres, the functions' owner).
    SELECT * INTO v_claim FROM public.claim_lifecycle_email(v_row_id, 120);
    IF v_claim.id IS NULL THEN
      RAISE EXCEPTION 'Assertion failed: service_role could not reclaim the stale checkin_7d row';
    END IF;

    v_complete_result := public.complete_lifecycle_email(v_row_id, v_claim.claim_token, 'sent', 'test_provider_msg_id_service_role');
    IF NOT v_complete_result THEN
      RAISE EXCEPTION 'Assertion failed: service_role could not complete the checkin_7d row it just claimed';
    END IF;

    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;

  PERFORM 1 FROM public.lifecycle_emails
  WHERE id = v_row_id AND status = 'sent' AND sent_at IS NOT NULL AND claim_token IS NULL AND locked_until IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assertion failed: checkin_7d row was not left in the expected post-sent state after service_role execution';
  END IF;

  RAISE NOTICE 'Assertion passed: service_role actually claimed and completed a stale lifecycle_emails row end-to-end, under SET LOCAL ROLE, not merely catalog-privilege-checked.';
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
    WHERE schemaname = 'public' AND tablename <> 'lifecycle_emails'
  ) t;

  IF v_after IS DISTINCT FROM current_setting('lifecycle_dry_run.policies_before', true) THEN
    RAISE EXCEPTION 'Assertion failed: an existing policy (outside lifecycle_emails) changed during this dry run';
  END IF;

  SELECT (count(*) - 1)::text INTO v_table_count_after -- subtract the one new table
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r';

  IF v_table_count_after IS DISTINCT FROM current_setting('lifecycle_dry_run.table_count_before', true) THEN
    RAISE EXCEPTION 'Assertion failed: an unexpected table count change beyond the one new table';
  END IF;

  RAISE NOTICE 'Assertion passed: no existing table or policy was altered by this dry run.';
END
$assert_existing_unchanged$;

ROLLBACK;

-- Final status: confirms the rollback actually restored the exact
-- pre-transaction state (not merely that nothing changed while the
-- transaction was still open) — five separately named boolean columns,
-- each independently checkable, against the Step 0 baseline (10 tables,
-- 25 policies).
SELECT
  NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'lifecycle_emails'
  ) AS lifecycle_emails_table_absent,
  to_regprocedure('public.claim_lifecycle_email(uuid, integer)') IS NULL
    AS claim_lifecycle_email_absent,
  to_regprocedure('public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz)') IS NULL
    AS complete_lifecycle_email_absent,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r') = 10
    AS public_table_count_matches_baseline_10,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') = 25
    AS public_policy_count_matches_baseline_25;
-- expect: true, true, true, true, true


-- =======================================================================
-- STEP 2: Real migration
-- =======================================================================
-- Run lib/security/migration_lifecycle_emails.sql in full, exactly as
-- written (it has its own BEGIN...COMMIT). Not executed by this runbook.


-- =======================================================================
-- STEP 3: Post-migration verification (read-only)
-- =======================================================================

SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'lifecycle_emails'; -- expect: 17

SELECT count(*) FROM pg_policies WHERE schemaname = 'public'; -- expect: still 25 (unchanged)

SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname = 'lifecycle_emails'; -- expect: true, false

SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'lifecycle_emails'
ORDER BY grantee, privilege_type; -- expect: only service_role rows (SELECT, INSERT, UPDATE)

SELECT has_function_privilege('service_role', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE'),
       has_function_privilege('anon', 'public.claim_lifecycle_email(uuid, integer)', 'EXECUTE');
-- expect: true, false, false


-- =======================================================================
-- STEP 4: Supervised disposable-account test (manual, not SQL)
-- =======================================================================
-- 1. Sign up one disposable email through the real production signup
--    flow and confirm it (Confirm Email is ON).
-- 2. Confirm exactly one 'welcome'-type row was created for that user's
--    id: SELECT * FROM public.lifecycle_emails WHERE user_id = '<uuid>';
-- 3. Trigger the immediate-welcome endpoint path (the normal /auth/confirm
--    flow already does this) and confirm the row reaches status = 'sent'
--    with a non-null sent_at and provider_message_id, and that the
--    Resend Emails dashboard shows exactly one corresponding send.
-- 4. Run the cron route with ?userId=<uuid>&dryRun=true first, then
--    without dryRun, and confirm it reports the row as already sent
--    (skipped), not sent a second time.
-- 5. Delete the disposable auth.users row via the Dashboard and confirm
--    (via SELECT) that its lifecycle_emails rows are gone (FK cascade).


-- =======================================================================
-- STEP 5: Narrow rollback
-- =======================================================================
-- Removes only the objects this migration added. Does not touch
-- auth.users, auth.mfa_factors, any Phase 1C policy, flowtrack_private,
-- or any other existing table/function/row.

BEGIN;
DROP FUNCTION IF EXISTS public.claim_lifecycle_email(uuid, integer);
DROP FUNCTION IF EXISTS public.complete_lifecycle_email(uuid, uuid, text, text, text, timestamptz);
DROP TABLE IF EXISTS public.lifecycle_emails;
COMMIT;

-- Post-rollback check:
SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'lifecycle_emails'
) AS lifecycle_emails_exists_after_narrow_rollback; -- expect: false

SELECT count(*) FROM pg_policies WHERE schemaname = 'public'; -- expect: still 25


-- =======================================================================
-- APPENDIX: Manual STOP suppression (deliberate, per-user, never by email)
-- =======================================================================
-- For the first 10-20 users, there is no inbound-reply automation. When a
-- user replies STOP to a feedback_48h or checkin_7d email, Alberto:
--   1. Resolves that exact user's UUID deliberately — e.g. via the
--      Supabase Dashboard's Authentication > Users search, confirming the
--      one exact email address that sent the STOP reply, and copying that
--      row's UUID. Never resolved by an automated/ambiguous email match.
--   2. Runs the parameterized statement below with that UUID substituted
--      in — never a bare email address — so it is structurally impossible
--      for this to affect any user other than the one just resolved by
--      hand.
--
-- UPDATE public.lifecycle_emails
-- SET status = 'suppressed',
--     suppressed_at = now(),
--     suppression_reason = 'user_replied_stop',
--     updated_at = now()
-- WHERE user_id = '<paste-the-verified-uuid-here>'
--   AND email_type IN ('feedback_48h', 'checkin_7d')
--   AND status NOT IN ('sent', 'suppressed'); -- never un-sends an already-sent email
--
-- The equivalent application-layer function
-- (lib/lifecycle-emails/service.ts: suppressUpcomingLifecycleEmails) takes
-- the same UUID-only parameter and is covered by
-- lib/lifecycle-emails/service.test.ts, for future wiring into an internal
-- tool — no public/unauthenticated endpoint is created in this phase.
