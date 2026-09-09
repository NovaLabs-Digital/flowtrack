-- FlowTrack: signup lifecycle emails operational table (welcome,
-- ~48-hour feedback, 7-day check-in). Non-destructive: creates one new
-- table and two new functions; touches no existing table, function,
-- policy, or row. Run this independently in the Supabase SQL Editor,
-- after lib/security/lifecycle_emails_runbook.sql Steps 0 and 1. Wrapped
-- in a single transaction: any failure rolls back everything, so there is
-- never a partially-applied state.
--
-- Verified production facts this migration is scoped to (confirmed by
-- Alberto/prior phases, not assumed):
--   - current_user in the Supabase SQL Editor is postgres.
--   - postgres.rolbypassrls = true (verified in Security Phase 1C).
--   - auth.users exists with a uuid `id` primary key (Supabase-managed,
--     depended on by every FK in this project's own tables already).
--   - service_role is a real role on this project (Supabase-managed).
--   - flowtrack_private (from Security Phase 1C) is NOT part of
--     PostgREST's exposed-schema list. That is exactly why the two
--     functions below live in `public`, not `flowtrack_private`: the
--     application calls them via supabaseAdmin.rpc(...), which is a
--     PostgREST HTTP call and can only reach exposed-schema functions.
--     flowtrack_private.mfa_access_allowed() is a completely different
--     calling mechanism — it is evaluated in-database by RLS policy
--     predicates, never invoked over PostgREST — so its schema choice does
--     not set a precedent for these two.
--
-- Scope: adds public.lifecycle_emails (RLS enabled, zero policies, no
-- PUBLIC/anon/authenticated grants — service_role/postgres only) and two
-- service_role-only functions implementing an atomic claim/lease and a
-- claim-token-checked completion, so concurrent cron runs cannot double-
-- send the same row. Does not modify auth.users, auth.mfa_factors, any
-- Phase 1C policy, or any existing application table or row.
--
-- Repeatability: the table-creation step is deliberately NOT idempotent —
-- the preflight below fails loudly if public.lifecycle_emails already
-- exists, forcing a human to investigate rather than silently skipping or
-- re-creating. The two functions use CREATE OR REPLACE and are therefore
-- safely re-runnable on their own once the table exists.

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

COMMIT;
