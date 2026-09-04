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
--
-- Verified production facts this runbook is scoped to: current_user in the
-- SQL Editor is postgres; postgres is NOT a superuser and is NOT a member
-- of supabase_admin; all ten public tables and public.handle_new_user() are
-- postgres-owned. Every step below therefore operates only on objects
-- postgres owns or on postgres's own default-privilege entries — nothing
-- here requires supabase_admin membership or superuser privilege. The one
-- item that genuinely is out of postgres's reach (supabase_admin's own
-- future-object defaults) is documented, not executed, in the
-- "Supabase-managed follow-up" section near the end of this file.

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

-- 0b. RLS enabled state and owner for every public table (confirms the
-- verified-postgres-owned fact this whole runbook is scoped to).
SELECT relname AS table_name, relowner::regrole AS owner,
       relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
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
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS priv
JOIN pg_roles g ON g.oid = priv.grantee
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND g.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 0e. Default ACLs for future public objects (tables and functions).
-- defaclobjtype: 'r' = relation/table, 'f' = function. Informational only —
-- this migration corrects the 'r' (table) entry for postgres; it
-- deliberately does NOT touch supabase_admin's entries (postgres cannot —
-- see "Supabase-managed follow-up" below) and does NOT touch the 'f'
-- (function) entries this phase (see the note near the top of
-- migration_privilege_hardening.sql and
-- lib/security/FUNCTION_PRIVILEGE_CONVENTION.md), so those rows are not a
-- before/after comparison target for Step 3.
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
-- aclexplode output as grantee = 0). Uses COALESCE(proacl,
-- acldefault('f', proowner)) so this is correct even if proacl happens to be
-- NULL (meaning "no explicit ACL override yet, defer entirely to the
-- compiled-in default") rather than silently reporting both as false in
-- that case. This determines whether the migration's explicit GRANT to
-- supabase_auth_admin is adding something new or merely making an already-
-- true fact explicit — record the result before migrating; Step 5's
-- rollback documentation depends on knowing which case this is.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'handle_new_user'
      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'supabase_auth_admin')
      AND a.privilege_type = 'EXECUTE'
  ) AS supabase_auth_admin_has_explicit_execute_grant,
  EXISTS (
    SELECT 1
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
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
-- via PUBLIC; use 0f-extended to tell those two cases apart). anon and
-- authenticated are legitimate has_function_privilege() targets — they are
-- ordinary login/group roles, not the PUBLIC pseudo-role.
SELECT
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')                AS anon_can_execute,
  has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')       AS authenticated_can_execute,
  has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') AS supabase_auth_admin_can_execute;

-- Save the output of 0a–0h somewhere before continuing — Steps 3 and 4
-- compare against this baseline.


-- =======================================================================
-- STEP 1 — Transactional dry run (proves the migration works and that
-- rolling it back returns the database to its exact original state).
-- Verifies EFFECTIVE privileges via has_table_privilege() for anon/
-- authenticated/supabase_auth_admin, and via direct ACL inspection
-- (aclexplode + grantee = 0) for PUBLIC, since PUBLIC is a pseudo-role, not
-- a normal login role, and has_function_privilege('public', ...) is not the
-- correct way to query it. Also creates one disposable probe table, purely
-- inside this transaction, to empirically prove the future-table default
-- correction is actually effective for a newly created table, rather than
-- assuming it worked because the REVOKE/ALTER DEFAULT PRIVILEGES statement
-- executed without error.
-- =======================================================================

BEGIN;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON
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
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;

-- Empirical probe: do not assume the ALTER DEFAULT PRIVILEGES statement
-- above changed effective future-table defaults merely because it executed
-- successfully. Create one uniquely named, disposable table AFTER that
-- statement — this exercises the default exactly the way a real future
-- table creation would — and check its EFFECTIVE privileges directly. This
-- table exists ONLY inside this Step 1 transaction, uses no user data,
-- modifies no existing table, is never added to
-- migration_privilege_hardening.sql, and is never created outside this dry
-- run — it is removed automatically by the ROLLBACK below.
CREATE TABLE public.__flowtrack_privilege_probe (
  id bigint
);

SELECT
  has_table_privilege('anon', 'public.__flowtrack_privilege_probe', 'TRUNCATE')            AS anon_has_truncate,
  has_table_privilege('anon', 'public.__flowtrack_privilege_probe', 'REFERENCES')          AS anon_has_references,
  has_table_privilege('anon', 'public.__flowtrack_privilege_probe', 'TRIGGER')             AS anon_has_trigger,
  has_table_privilege('anon', 'public.__flowtrack_privilege_probe', 'MAINTAIN')            AS anon_has_maintain,
  has_table_privilege('authenticated', 'public.__flowtrack_privilege_probe', 'TRUNCATE')   AS authenticated_has_truncate,
  has_table_privilege('authenticated', 'public.__flowtrack_privilege_probe', 'REFERENCES') AS authenticated_has_references,
  has_table_privilege('authenticated', 'public.__flowtrack_privilege_probe', 'TRIGGER')    AS authenticated_has_trigger,
  has_table_privilege('authenticated', 'public.__flowtrack_privilege_probe', 'MAINTAIN')   AS authenticated_has_maintain;
-- Expect ALL EIGHT columns FALSE for both roles. This is the actual proof
-- that the corrected default is effective for a newly created table, not
-- just that the REVOKE/ALTER DEFAULT PRIVILEGES text ran without error.

ALTER FUNCTION public.handle_new_user() SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- Verify EFFECTIVE table privileges WHILE STILL INSIDE the transaction.
-- Expect: has_truncate/has_references/has_trigger/has_maintain all FALSE
-- for anon and authenticated on every table; has_select/insert/update/
-- delete UNCHANGED from the Step 0d baseline (compare row-by-row) — this is
-- the proof that ordinary CRUD remains untouched.
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

-- Verify EFFECTIVE function privileges.
-- PUBLIC: inspected directly via the ACL (grantee = 0), NOT via
-- has_function_privilege('public', ...) — PUBLIC is a pseudo-role/grantee,
-- not a normal login role, and this is the correct way to check it.
-- anon / authenticated / supabase_auth_admin: has_function_privilege() is
-- correct for these, since they are ordinary roles.
-- Expect: public_has_execute FALSE, anon_can_execute FALSE,
-- authenticated_can_execute FALSE, supabase_auth_admin_can_execute TRUE.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'handle_new_user'
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) AS public_has_execute,
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

-- Confirm the probe table was actually removed by ROLLBACK and left no
-- trace — expect: true.
SELECT to_regclass('public.__flowtrack_privilege_probe') IS NULL AS probe_table_gone;

-- Immediately re-run Step 0 (0a through 0h, including 0f-extended) here and
-- confirm the output is identical to what you saved before Step 1 — this
-- proves ROLLBACK genuinely restored the original state and the dry run
-- left nothing behind. In particular, re-run 0e (default ACLs) and confirm
-- the postgres/public/'r' (table) default-ACL entry is byte-for-byte
-- identical to its original baseline value — the probe above proves the
-- corrected default was effective DURING the transaction; this confirms it
-- left no permanent change after rollback either.


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

-- RLS still enabled and owner unchanged, exactly as in Step 0b (compare
-- row-by-row).
SELECT relname AS table_name, relowner::regrole AS owner,
       relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
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
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS priv
JOIN pg_roles g ON g.oid = priv.grantee
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND g.rolname = 'service_role'
ORDER BY table_name, privilege_type;

-- Future table default ACLs corrected for postgres — compare against Step
-- 0e; the 'r' (table) row for postgres should no longer show D/x/t/m for
-- anon/authenticated. supabase_admin's rows and the 'f' (function) rows are
-- NOT expected to have changed — this migration does not touch them (see
-- Step 0e's note and the "Supabase-managed follow-up" section below).
SELECT defaclrole::regrole AS default_owner, defaclnamespace::regnamespace AS schema,
       defaclobjtype, defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace
ORDER BY default_owner, defaclobjtype;

-- handle_new_user: still SECURITY DEFINER, search_path fixed, no rewritten
-- body, trigger untouched.
SELECT p.proname, r.rolname AS owner, p.prosecdef AS security_definer, p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_roles r ON r.oid = p.proowner
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'handle_new_user';

-- EFFECTIVE function privileges, same PUBLIC-via-ACL / has_function_privilege
-- split as Step 1. Expect public_has_execute/anon_can_execute/
-- authenticated_can_execute all FALSE, supabase_auth_admin_can_execute TRUE.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'handle_new_user'
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) AS public_has_execute,
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')                AS anon_can_execute,
  has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')       AS authenticated_can_execute,
  has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE') AS supabase_auth_admin_can_execute;

-- Trigger still exists and still targets public.handle_new_user() —
-- confirms the trigger and function body were never touched.
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
-- (reverses the migration's item A only — this migration never modified
-- SELECT/INSERT/UPDATE/DELETE, so nothing to restore there).
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

-- Restore future-table defaults for postgres only — this migration never
-- touched supabase_admin's defaults (postgres cannot), so there is nothing
-- to restore for that role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
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
-- explicit where it previously wasn't." This rollback does not claim
-- byte-for-byte restoration in the first case, and says so explicitly.
ALTER FUNCTION public.handle_new_user() RESET search_path;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated;

COMMIT;

-- After rollback, re-run Step 0's queries (0a–0d, 0f, 0f-extended, 0h) and
-- confirm the output matches the original baseline, with the one
-- documented exception above if applicable.


-- =======================================================================
-- Supabase-managed follow-up — not executable by Alberto
-- =======================================================================
-- postgres is not a superuser and is not a member of supabase_admin, so it
-- cannot run ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin — Postgres
-- requires the executing role to either BE the target role, be a direct or
-- indirect member of it, or be a superuser. None of those hold for postgres
-- with respect to supabase_admin in this project.
--
-- This is not a blocker for Phase 1A: all ten verified FlowTrack tables and
-- public.handle_new_user() are postgres-owned (confirmed in Step 0b/0f), so
-- every privilege correction this phase needs is fully covered by what
-- postgres can already do on its own objects. Existing FlowTrack tables are
-- unaffected by supabase_admin's default-privilege configuration.
--
-- If a later phase determines that a supabase_admin-created public table
-- also needs its default TRUNCATE/REFERENCES/TRIGGER/MAINTAIN privileges
-- corrected (e.g. because Supabase's own platform tooling starts creating
-- tables in public as supabase_admin), the following statement is what
-- would need to be applied — but it must be requested through Supabase
-- Support or another Supabase-authorized managed-role process, not run by
-- Alberto, and not by granting postgres membership in supabase_admin or any
-- other permission-bypass workaround:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--     ON TABLES FROM anon, authenticated;
--
-- Treat this as a documented residual hardening item to revisit if/when it
-- becomes relevant, not as something Phase 1A depends on.


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
-- rolls everything back, leaving no trace. Scoped to postgres only, since
-- postgres is the role that would create such a function in practice and
-- is the only role this proof needs to reason about.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Create a throwaway function AFTER the default-privilege change, as
-- postgres, in the public schema — this is exactly the scenario the
-- default is supposed to govern.
CREATE FUNCTION public._phase1a_default_privilege_probe() RETURNS void
LANGUAGE sql AS $$ SELECT 1 $$;

-- If the default-privilege change is effective, public_has_execute should
-- be FALSE and anon/authenticated_can_execute should be FALSE. If any is
-- TRUE, the ALTER DEFAULT PRIVILEGES statement did not prevent
-- PUBLIC-equivalent access for that role on this database, and the
-- per-function convention (not a schema-wide default) remains the correct
-- and only approach. PUBLIC is checked via direct ACL inspection, not
-- has_function_privilege('public', ...), for the same reason as Steps 1/3.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = '_phase1a_default_privilege_probe'
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) AS public_has_execute,
  has_function_privilege('anon', 'public._phase1a_default_privilege_probe()', 'EXECUTE')          AS anon_can_execute,
  has_function_privilege('authenticated', 'public._phase1a_default_privilege_probe()', 'EXECUTE') AS authenticated_can_execute;

DROP FUNCTION public._phase1a_default_privilege_probe();

ROLLBACK;

-- Re-run Step 0e afterward and confirm the 'f' (function) default-ACL row
-- for postgres/public is unchanged from the original baseline — proving
-- this probe left nothing behind.
