-- FlowTrack: "launch cohort" one-time email campaign — operational tables
-- for an explicitly-approved cohort of EXISTING external users. Separate
-- from public.lifecycle_emails (lib/security/migration_lifecycle_emails.sql)
-- in every respect: separate tables, separate RPCs, separate cron route,
-- separate rollout config. Does not modify lifecycle_emails, its RPCs, its
-- cron, auth.users, auth.mfa_factors, any RLS policy on an existing table,
-- Stripe/billing tables, or Bill Guardian's debts table. Run this
-- independently in the Supabase SQL Editor, after
-- lib/security/launch_cohort_runbook.sql Steps 0 and 1. Wrapped in a single
-- transaction: any failure rolls back everything, so there is never a
-- partially-applied state.
--
-- Verified production facts this migration is scoped to (confirmed by
-- Alberto/prior phases, not assumed):
--   - current_user in the Supabase SQL Editor is postgres.
--   - postgres.rolbypassrls = true (verified in Security Phase 1C).
--   - auth.users exists with a uuid `id` primary key (Supabase-managed,
--     depended on by every FK in this project's own tables already).
--   - service_role is a real role on this project (Supabase-managed), and
--     Supabase's platform-level default privileges grant service_role ALL
--     PRIVILEGES on every new public-schema table automatically (the exact
--     fact that caused a production incident on lifecycle_emails — see
--     migration_lifecycle_emails.sql's own header and Section B below for
--     why every REVOKE ALL in this file explicitly includes service_role
--     from the start, rather than needing a later fix).
--
-- Scope: adds two new tables and two new service_role-only functions.
-- public.launch_cohort_members is the enrollment roster: Alberto populates
-- it manually (lib/security/launch_cohort_runbook.sql Step 4), after
-- reviewing each candidate in the Supabase Dashboard — the application
-- itself is never granted INSERT on this table, so it can never enroll
-- anyone on its own. public.launch_cohort_emails is the per-email send
-- state (one row per enrolled user per email type), mirroring
-- public.lifecycle_emails' proven atomic-claim/lease design exactly. Does
-- not modify auth.users, auth.mfa_factors, any Phase 1C policy,
-- lifecycle_emails, or any existing application table or row.
--
-- Repeatability: both CREATE TABLE statements are deliberately NOT
-- idempotent — the preflight below fails loudly if either table already
-- exists, forcing a human to investigate rather than silently skipping or
-- re-creating. The two functions use CREATE OR REPLACE and are therefore
-- safely re-runnable on their own once the tables exist.

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

COMMIT;
