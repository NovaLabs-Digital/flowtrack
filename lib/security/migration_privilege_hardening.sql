-- FlowTrack: Database privilege hardening (Security Phase 1A) — non-destructive
-- Run this independently in the Supabase SQL Editor. Safe to run more than
-- once. Wrapped in a single transaction: any failure rolls back everything,
-- so there is never a partially-applied privilege state.
--
-- Scope: removes privileges that were never intentionally granted and that
-- FlowTrack's application code never uses (TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) from the anon and authenticated roles — both on the ten
-- existing public tables (budgets, budgets_backup, categories,
-- categories_backup, debts, plan, profiles, transactions,
-- transactions_backup, users) and, via ALTER DEFAULT PRIVILEGES, on any
-- future public table created by postgres or supabase_admin. It also locks
-- down public.handle_new_user() (the auth signup trigger function) with a
-- fixed empty search_path and a narrowed EXECUTE grant limited to
-- supabase_auth_admin.
--
-- Deliberately NOT touched by this migration: SELECT/INSERT/UPDATE/DELETE
-- grants (FlowTrack's existing CRUD access is unchanged), service_role,
-- database-owner privileges, any RLS policy, any row of data, and
-- handle_new_user's INSERT/ON CONFLICT behavior or 'free' default plan.
--
-- Deliberately NOT included: an ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS
-- change to make future public functions non-executable by default. Postgres
-- documents ALTER DEFAULT PRIVILEGES as the mechanism that overrides its own
-- built-in default (EXECUTE to PUBLIC on newly created functions), scoped to
-- (role, schema), which is why a statement like
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- should, per that documented mechanism, be effective going forward for
-- functions postgres creates in public. But this project has not yet proven
-- that empirically against this specific Supabase-managed database, and a
-- default-privilege change scoped to "every future function in public" is
-- broad enough that an unproven assumption here is a bad trade against the
-- alternative: a mandatory, explicit, per-function convention that is
-- correct regardless of how the default behaves. See
-- lib/security/FUNCTION_PRIVILEGE_CONVENTION.md for that convention (which
-- every future public function must follow, migration-enforced by
-- lib/security/function_privilege_convention.test.ts) and the "Appendix"
-- section of lib/security/privilege_hardening_runbook.sql for an optional,
-- rollback-only proof procedure if this default is ever worth adopting in a
-- later phase.
--
-- Before running this against production, run
-- lib/security/privilege_hardening_runbook.sql Steps 0 and 1 first.

BEGIN;

-- ---------------------------------------------------------------------
-- Preflight: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin can only be
-- executed by supabase_admin itself, a direct/indirect member of
-- supabase_admin, or a superuser. The SQL Editor's session role (postgres)
-- may or may not have that membership in this project. Fail loudly and
-- immediately, before any privilege is touched, rather than silently
-- skipping the supabase_admin table-default correction if it isn't
-- permitted.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF NOT (
    pg_has_role(current_user, 'supabase_admin', 'MEMBER')
    OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  ) THEN
    RAISE EXCEPTION
      'Preflight failed: role "%" is not a member of supabase_admin and is not a superuser, so it cannot run ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin. No privileges have been changed by this migration. Manual alternative: see the "If the preflight check fails" section of lib/security/privilege_hardening_runbook.sql — this requires Supabase Support to apply the supabase_admin-scoped statement on your behalf, since supabase_admin is a Supabase-managed role. Do not grant supabase_admin membership to postgres, and do not attempt any other permission bypass to work around this.',
      current_user;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Existing tables: revoke unused privileges from anon and authenticated.
-- SELECT/INSERT/UPDATE/DELETE are untouched — this only removes privileges
-- FlowTrack's application code has never used. Idempotent: revoking a
-- privilege a role doesn't currently hold is a no-op, not an error.
-- ---------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Future tables: correct the default privilege set so anything created
-- later by postgres or supabase_admin does not automatically hand anon/
-- authenticated the same four unused privileges. Existing default CRUD
-- grants for anon/authenticated are intentionally left as-is for now — a
-- broader anon-role reduction is a separate, later audit. (This is a TABLE
-- default-privilege correction, not a function one — see the note above on
-- why the function-default case is deliberately excluded from this phase.)
-- ---------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Harden public.handle_new_user(), the SECURITY DEFINER signup-trigger
-- function fired by on_auth_user_created (AFTER INSERT on auth.users).
-- The function BODY is not changed — its exact INSERT ... ON CONFLICT
-- behavior, columns, and 'free' default plan are preserved unmodified.
-- Only its search_path and its EXECUTE grants change:
--   - A fixed, empty search_path removes any ambiguity from an unqualified
--     identifier resolving against a schema an attacker could manipulate.
--     Safe here specifically because the body already fully qualifies every
--     reference as public.profiles.
--   - EXECUTE is revoked from PUBLIC/anon/authenticated (nothing in the app
--     calls this function directly — it only ever runs as the target of the
--     auth trigger) and explicitly (re)granted to supabase_auth_admin, the
--     owner of auth.users and the role that fires the trigger. Whether
--     supabase_auth_admin previously held EXECUTE explicitly or only via
--     inheritance from PUBLIC is not yet confirmed — see Step 0's extended
--     ACL check in the runbook before relying on either assumption.
-- The trigger itself (on_auth_user_created) is not dropped or recreated,
-- and no row in auth.users is read, written, or touched.
-- ---------------------------------------------------------------------
ALTER FUNCTION public.handle_new_user() SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

COMMIT;
