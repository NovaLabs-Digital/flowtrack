-- FlowTrack: Privilege hardening runbook (Security Phase 1A)
-- Companion to lib/security/migration_privilege_hardening.sql.
--
-- This file is a sequence of clearly labeled, independently-runnable
-- SQL Editor steps. It is NOT meant to be executed top-to-bottom as one
-- script — run each step's block deliberately, read its output, and only
-- move on once you understand what it shows. Steps 0, 1, 3, and 4's
-- verification queries are strictly read-only or end in ROLLBACK. Step 2 is
-- an instruction, not SQL. Step 5 (rollback) is only for use if Step 3/4
-- reveals a problem after the real migration has been applied. The
-- Appendix is optional and not required for Phase 1A sign-off.

-- =======================================================================
-- STEP 0 — Read-only baseline (run before anything else)
-- =======================================================================

-- 0a. Row counts, aggregated only.
SELECT 'budgets' AS table_name, COUNT(*) FROM public.budgets
UNION ALL SELECT 'budgets_backup', COUNT(*) FROM public.budgets_backup
UNION ALL SELECT 'categories', COUNT(*) FROM public.categories
UNION ALL SELECT 'categories_backup', COUNT(*) FROM public.categories_backup
UNION ALL SELECT 'debts', COUNT(*) FROM public.debts
UNION ALL SELECT 'plan', COUNT(*) FROM public.plan
UNION ALL SELECT 'profiles', COUNT(*) FROM public.profiles
UNION ALL SELECT 'transactions', COUNT(*) FROM public.transactions
UNION ALL SELECT 'transactions_backup', COUNT(*) FROM public.transactions_backup
UNION ALL SELECT 'users', COUNT(*) FROM public.users
ORDER BY table_name;

-- 0b. RLS enabled state for every public table.
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
ORDER BY relname;

-- 0c. Complete pg_policies snapshot (every existing ownership policy).
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 0d. Effective privileges for anon/authenticated on every existing table,
-- using has_table_privilege() — this is the authoritative "can this role
-- actually do this" check (it accounts for PUBLIC-inherited privileges,
-- role membership, etc.), not just a literal ACL-entry inspection.
WITH tables(table_name) AS (
  VALUES ('budgets'), ('budgets_backup'), ('categories'), ('categories_backup'),
         ('debts'), ('plan'), ('profiles'), ('transactions'),
         ('transactions_backup'), ('users')
),
roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT
  t.table_name,
  r.role_name,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT')     AS has_select,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT')     AS has_insert,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE')     AS has_update,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE')     AS has_delete,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE')   AS has_truncate,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'REFERENCES') AS has_references,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRIGGER')    AS has_trigger,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'MAINTAIN')   AS has_maintain
FROM tables t CROSS JOIN roles r
ORDER BY t.table_name, r.role_name;

-- 0d-raw. Same information in literal-ACL form (useful as a secondary,
-- lower-level cross-check against 0d, and to see service_role's grants too).
-- Privilege codes: r=SELECT a=INSERT w=UPDATE d=DELETE D=TRUNCATE
-- x=REFERENCES t=TRIGGER m=MAINTAIN.
SELECT c.relname AS table_name, g.rolname AS grantee, priv.privilege_type
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS priv
JOIN pg_roles g ON g.oid = priv.grantee
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND g.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 0e. Default ACLs for future public objects (tables and functions).
-- defaclobjtype: 'r' = relation/table, 'f' = function. Informational only —
-- this migration corrects the 'r' (table) entries for postgres/
-- supabase_admin; it deliberately does NOT touch the 'f' (function) entries
-- this phase (see the note near the top of migration_privilege_hardening.sql
-- and lib/security/FUNCTION_PRIVILEGE_CONVENTION.md), so the 'f' rows here
-- are not a before/after comparison target for Step 3.
SELECT defaclrole::regrole AS default_owner, defaclnamespace::regnamespace AS schema,
       defaclobjtype, defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace
ORDER BY default_owner, defaclobjtype;

-- 0f. handle_new_user: owner, SECURITY DEFINER flag, search_path config, ACL.
SELECT p.proname, r.rolname AS owner, p.prosecdef AS security_definer,
       p.proconfig AS config_settings, p.proacl
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'handle_new_user';

-- 0f-extended. Distinguishes an EXPLICIT EXECUTE grant to supabase_auth_admin
-- from access that only exists because PUBLIC has EXECUTE (PUBLIC appears in
-- aclexplode output as grantee = 0). This determines whether the migration's
-- explicit GRANT to supabase_auth_admin is adding something new or merely
-- making an already-true fact explicit — record the result before migrating;
-- Step 5's rollback documentation depends on knowing which case this is.
SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'handle_new_user'
      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'supabase_auth_admin')
      AND a.privilege_type = 'EXECUTE'
  ) AS supabase_auth_admin_has_explicit_execute_grant,
  EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'handle_new_user'
      AND a.grantee = 0  -- 0 = the PUBLIC pseudo-role in aclexplode output
      AND a.privilege_type = 'EXECUTE'
  ) AS public_has_execute_grant;

-- 0g. Trigger presence and exact definition.
SELECT tgname, tgrelid::regclass AS table_name, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- 0h. Confirm supabase_auth_admin can currently execute the function
-- (effective privilege — true whether the access is explicit or inherited
-- via PUBLIC; use 0f-extended to tell those two cases apart).
SELECT has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') AS can_execute;

-- Save the output of 0a–0h somewhere before continuing — Steps 3 and 4
-- compare against this baseline.


-- =======================================================================
-- STEP 1 — Transactional dry run (proves the migration works and that
-- rolling it back returns the database to its exact original state).
-- Verifies EFFECTIVE privileges via has_table_privilege()/
-- has_function_privilege(), not just that REVOKE/GRANT text was run.
-- =======================================================================

BEGIN;

-- Same preflight check as the real migration.
DO $preflight$
BEGIN
  IF NOT (
    pg_has_role(current_user, 'supabase_admin', 'MEMBER')
    OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  ) THEN
    RAISE EXCEPTION
      'Preflight failed: role "%" cannot run ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin. See the "If the preflight check fails" section below.',
      current_user;
  END IF;
END
$preflight$;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

ALTER FUNCTION public.handle_new_user() SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- Verify EFFECTIVE table privileges WHILE STILL INSIDE the transaction.
-- Expect: has_truncate/has_references/has_trigger/has_maintain all FALSE
-- for anon and authenticated on every table; has_select/insert/update/
-- delete UNCHANGED from the Step 0d baseline (compare row-by-row).
WITH tables(table_name) AS (
  VALUES ('budgets'), ('budgets_backup'), ('categories'), ('categories_backup'),
         ('debts'), ('plan'), ('profiles'), ('transactions'),
         ('transactions_backup'), ('users')
),
roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT
  t.table_name,
  r.role_name,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT')     AS has_select,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT')     AS has_insert,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE')     AS has_update,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE')     AS has_delete,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE')   AS has_truncate,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'REFERENCES') AS has_references,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRIGGER')    AS has_trigger,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'MAINTAIN')   AS has_maintain
FROM tables t CROSS JOIN roles r
ORDER BY t.table_name, r.role_name;

-- Verify EFFECTIVE function privileges. Expect: public/anon_can_execute/
-- authenticated_can_execute all FALSE, supabase_auth_admin_can_execute TRUE.
-- ('public' as a literal lowercase string is specially interpreted by
-- has_function_privilege() to mean the PUBLIC pseudo-role.)
SELECT
  has_function_privilege('public', 'public.handle_new_user()', 'EXECUTE')              AS public_can_execute,
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')                AS anon_can_execute,
  has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')       AS authenticated_can_execute,
  has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') AS supabase_auth_admin_can_execute;

-- Also confirm SECURITY DEFINER and search_path landed as expected.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig AS config_settings
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'handle_new_user';

-- Do NOT commit the dry run.
ROLLBACK;

-- Immediately re-run Step 0 (0a through 0h, including 0f-extended) here and
-- confirm the output is identical to what you saved before Step 1 — this
-- proves ROLLBACK genuinely restored the original state and the dry run
-- left nothing behind.


-- =======================================================================
-- STEP 2 — Actual migration
-- =======================================================================
-- Do not paste migration statements here. Open and run
-- lib/security/migration_privilege_hardening.sql directly, as its own
-- separate SQL Editor execution, only after Steps 0 and 1 above look
-- correct. Keeping it a separate file/execution avoids any ambiguity
-- about whether this runbook accidentally re-applies it a second time.


-- =======================================================================
-- STEP 3 — Post-migration verification (run after Step 2 completes)
-- =======================================================================

-- All ten tables still exist and row counts are unchanged vs. Step 0a.
SELECT 'budgets' AS table_name, COUNT(*) FROM public.budgets
UNION ALL SELECT 'budgets_backup', COUNT(*) FROM public.budgets_backup
UNION ALL SELECT 'categories', COUNT(*) FROM public.categories
UNION ALL SELECT 'categories_backup', COUNT(*) FROM public.categories_backup
UNION ALL SELECT 'debts', COUNT(*) FROM public.debts
UNION ALL SELECT 'plan', COUNT(*) FROM public.plan
UNION ALL SELECT 'profiles', COUNT(*) FROM public.profiles
UNION ALL SELECT 'transactions', COUNT(*) FROM public.transactions
UNION ALL SELECT 'transactions_backup', COUNT(*) FROM public.transactions_backup
UNION ALL SELECT 'users', COUNT(*) FROM public.users
ORDER BY table_name;

-- RLS still enabled exactly as in Step 0b (compare row-by-row).
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
ORDER BY relname;

-- Existing ownership policies unchanged vs. Step 0c (compare row-by-row).
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- EFFECTIVE table privileges, post-migration. Compare against Step 0d:
-- has_select/insert/update/delete must be identical for every row;
-- has_truncate/has_references/has_trigger/has_maintain must now all be
-- FALSE for anon and authenticated on every table.
WITH tables(table_name) AS (
  VALUES ('budgets'), ('budgets_backup'), ('categories'), ('categories_backup'),
         ('debts'), ('plan'), ('profiles'), ('transactions'),
         ('transactions_backup'), ('users')
),
roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT
  t.table_name,
  r.role_name,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT')     AS has_select,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT')     AS has_insert,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE')     AS has_update,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE')     AS has_delete,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE')   AS has_truncate,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'REFERENCES') AS has_references,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRIGGER')    AS has_trigger,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'MAINTAIN')   AS has_maintain
FROM tables t CROSS JOIN roles r
ORDER BY t.table_name, r.role_name;

-- service_role privileges unchanged vs. the service_role rows captured in
-- Step 0d-raw (compare row-by-row — this migration never referenced
-- service_role in any REVOKE/GRANT statement, so this should be identical).
SELECT c.relname AS table_name, g.rolname AS grantee, priv.privilege_type
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS priv
JOIN pg_roles g ON g.oid = priv.grantee
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND g.rolname = 'service_role'
ORDER BY table_name, privilege_type;

-- Future table default ACLs corrected — compare against Step 0e; the 'r'
-- (table) rows for postgres/supabase_admin should no longer show D/x/t/m
-- for anon/authenticated. The 'f' (function) rows are NOT expected to have
-- changed — this migration does not touch them (see Step 0e's note); a
-- future public function's privileges are guarded per-migration by
-- lib/security/function_privilege_convention.test.ts instead.
SELECT defaclrole::regrole AS default_owner, defaclnamespace::regnamespace AS schema,
       defaclobjtype, defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace
ORDER BY default_owner, defaclobjtype;

-- handle_new_user: still SECURITY DEFINER, search_path fixed.
SELECT p.proname, r.rolname AS owner, p.prosecdef AS security_definer, p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'handle_new_user';

-- EFFECTIVE function privileges. Expect all three of the first columns
-- FALSE and the last TRUE.
SELECT
  has_function_privilege('public', 'public.handle_new_user()', 'EXECUTE')              AS public_can_execute,
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')                AS anon_can_execute,
  has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')       AS authenticated_can_execute,
  has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') AS supabase_auth_admin_can_execute;

-- Trigger still exists and still targets public.handle_new_user().
SELECT tgname, tgrelid::regclass AS table_name, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';


-- =======================================================================
-- STEP 4 — Signup safety verification
-- =======================================================================
-- Do not run this automatically and do not create a real production user
-- as part of applying the migration. This is a separate, deliberate,
-- supervised action Alberto performs himself, after Step 3 passes.
--
-- Preferred procedure:
--   1. In the Supabase Dashboard, go to Authentication > Users > Add user,
--      and create exactly one throwaway account with a clearly disposable
--      address, e.g. flowtrack-security-test+<yyyymmdd>@appflowtrack.com.
--      (Using the dashboard's "Add user" exercises the same
--      auth.users INSERT -> on_auth_user_created -> handle_new_user() path
--      as a real signup; using the app's own /signup form works equally
--      well and is an even closer end-to-end check if preferred.)
--   2. Immediately run:
SELECT id, email, plan FROM public.profiles WHERE email = '<the test email you used>';
--   3. Expected result: exactly one row, email matches, plan = 'free'.
--      If you also want to confirm the ON CONFLICT branch still works,
--      create the same auth user a second time (or trigger any flow that
--      re-fires the insert) and confirm the profiles row is updated in
--      place rather than duplicated or erroring.
--
-- Stop conditions — if any of these happen, STOP. Do not proceed to any
-- further phase, and do not delete the test account yet (keep it for
-- debugging):
--   - No profiles row appears at all.
--   - The row appears with plan other than 'free', or a mismatched email.
--   - The Dashboard "Add user" action itself errors out.
--   If any of these occur, capture the exact error text, re-run Step 3's
--   handle_new_user/trigger checks to see what changed, and consider
--   Step 5 (rollback) as the recovery path.
--
-- Cleanup procedure (only after the test above passes):
--   1. Delete the test account via Dashboard > Authentication > Users.
--   2. Confirm no orphaned profiles row remains (there is no known
--      ON DELETE CASCADE from profiles.id to auth.users.id in this repo's
--      migrations, so this must be checked explicitly, not assumed):
SELECT id, email, plan FROM public.profiles WHERE email = '<the test email you used>';
--   3. If a row remains, remove it explicitly:
DELETE FROM public.profiles WHERE email = '<the test email you used>';


-- =======================================================================
-- STEP 5 — Rollback (only if Step 3 or Step 4 reveals a problem)
-- =======================================================================
-- Narrowly reverses only this migration's grants/default-privileges/
-- search_path changes. Does not modify any data and does not touch any
-- existing RLS ownership policy. Use this only if signup or normal CRUD
-- is observed to fail after the migration — not as a routine step.
--
-- Restores privileges to exactly the ten tables this migration touched —
-- deliberately NOT "ON ALL TABLES IN SCHEMA public", because by the time a
-- rollback is needed, a table created after the migration ran would also
-- match that clause and would incorrectly receive TRUNCATE/REFERENCES/
-- TRIGGER/MAINTAIN it never had and was never meant to get from this
-- rollback.

BEGIN;

-- Restore table privileges to exactly the ten known baseline tables
-- (reverses Step 2's item 1 only — this migration never modified SELECT/
-- INSERT/UPDATE/DELETE, so nothing to restore there).
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON
  public.budgets,
  public.budgets_backup,
  public.categories,
  public.categories_backup,
  public.debts,
  public.plan,
  public.profiles,
  public.transactions,
  public.transactions_backup,
  public.users
  TO anon, authenticated;

-- Restore future-table defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES TO anon, authenticated;

-- Restore handle_new_user's original (unset) search_path and its prior
-- broad EXECUTE grant.
--
-- IMPORTANT — this does NOT claim byte-for-byte restoration of the function
-- ACL. Check Step 0f-extended's saved output before running this:
--   - If supabase_auth_admin_has_explicit_execute_grant was FALSE (it only
--     had EXECUTE via PUBLIC before the migration), then this rollback's
--     GRANT EXECUTE ... TO PUBLIC, anon, authenticated restores that
--     PUBLIC-inherited path, but the migration's explicit
--     "GRANT EXECUTE ... TO supabase_auth_admin" is deliberately NOT
--     revoked here — it is left in place permanently, as a redundant-but-
--     harmless explicit grant. Rolling it back to a state with zero
--     explicit grantees and only PUBLIC access is not worth the risk of
--     accidentally leaving supabase_auth_admin without EXECUTE if this
--     statement or a future migration ever removes the PUBLIC grant again.
--   - If it was TRUE (it already had an explicit grant before), this
--     rollback is a genuine, complete restoration for that role.
-- Either way, the end state always leaves supabase_auth_admin able to
-- execute the function — the only question this note resolves is whether
-- that access is "the same as before" or "the same access, now also made
-- explicit where it previously wasn't."
ALTER FUNCTION public.handle_new_user() RESET search_path;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated;

COMMIT;

-- After rollback, re-run Step 0's queries (0a–0d, 0f, 0f-extended, 0h) and
-- confirm the output matches the original baseline, with the one
-- documented exception above if applicable.


-- =======================================================================
-- If the preflight check fails
-- =======================================================================
-- If Step 1's dry run raises the preflight exception, the postgres role
-- used by the SQL Editor is not a member of supabase_admin and is not a
-- superuser in this project. Do not grant supabase_admin membership to
-- postgres and do not attempt any other privilege-escalation workaround
-- to get around this. The correct path is to open a support request with
-- Supabase asking them to apply, on their side, exactly this statement
-- against the FlowTrack project database:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--     ON TABLES FROM anon, authenticated;
--
-- Everything else in migration_privilege_hardening.sql (the existing-table
-- REVOKE, the postgres-owned table-default correction, and the
-- handle_new_user hardening) does not depend on supabase_admin membership
-- and can be applied independently while the supabase_admin-scoped
-- correction is pending with Supabase Support.


-- =======================================================================
-- APPENDIX — Optional: proof procedure for a future-function EXECUTE
-- default (NOT required for Phase 1A, NOT part of the applied migration)
-- =======================================================================
-- Phase 1A deliberately does not adopt an ALTER DEFAULT PRIVILEGES ... ON
-- FUNCTIONS change (see the note near the top of
-- migration_privilege_hardening.sql and
-- lib/security/FUNCTION_PRIVILEGE_CONVENTION.md for why). If a later phase
-- wants to actually establish that default instead of relying solely on
-- the per-function convention, this is a safe, rollback-only way to prove
-- whether it's effective on this specific database before adopting it —
-- it creates one throwaway function, checks its effective privileges, and
-- rolls everything back, leaving no trace.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Create a throwaway function AFTER the default-privilege change, as
-- postgres, in the public schema — this is exactly the scenario the
-- default is supposed to govern.
CREATE FUNCTION public._phase1a_default_privilege_probe() RETURNS void
LANGUAGE sql AS $$ SELECT 1 $$;

-- If the default-privilege change is effective, all three of these should
-- be FALSE. If any is TRUE, the ALTER DEFAULT PRIVILEGES statement did not
-- prevent PUBLIC-equivalent access for that role on this database, and the
-- per-function convention (not a schema-wide default) remains the correct
-- and only approach.
SELECT
  has_function_privilege('public', 'public._phase1a_default_privilege_probe()', 'EXECUTE') AS public_can_execute,
  has_function_privilege('anon', 'public._phase1a_default_privilege_probe()', 'EXECUTE')    AS anon_can_execute,
  has_function_privilege('authenticated', 'public._phase1a_default_privilege_probe()', 'EXECUTE') AS authenticated_can_execute;

DROP FUNCTION public._phase1a_default_privilege_probe();

ROLLBACK;

-- Re-run Step 0e afterward and confirm the 'f' (function) default-ACL rows
-- for postgres/public are unchanged from the original baseline — proving
-- this probe left nothing behind.
