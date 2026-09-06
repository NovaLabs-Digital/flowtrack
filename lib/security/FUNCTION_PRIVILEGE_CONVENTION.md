# Mandatory convention: explicit function privileges

Postgres automatically grants `EXECUTE` on every newly created function to
`PUBLIC` (which every role, including `anon` and `authenticated`, inherits
through). `lib/security/migration_privilege_hardening.sql` deliberately does
not rely on an `ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS` change to disable
this globally for the `public` schema — that mechanism is very likely
effective per documented Postgres semantics, but it has not been empirically
proven against this project's Supabase-managed database, and a
schema-wide default is broad enough that an unproven assumption there is a
bad trade against an explicit, per-function rule that is correct no matter
how the default behaves.

**Every future migration that runs `CREATE FUNCTION` or
`CREATE OR REPLACE FUNCTION`, in any schema, must, in the same migration
file, also:**

1. `REVOKE EXECUTE ON FUNCTION <schema>.<name>(...) FROM PUBLIC, anon, authenticated;`
2. `GRANT EXECUTE ON FUNCTION <schema>.<name>(...) TO <only the roles that need it>;`

This applies regardless of which schema the function lives in — including a
dedicated non-exposed schema such as `flowtrack_private` — since the implicit
`PUBLIC` grant Postgres adds on `CREATE FUNCTION` is schema-independent, and
relying on a schema not being PostgREST-exposed is a separate, complementary
control, not a substitute for an explicit grant.

No public function may rely on the implicit `PUBLIC` grant. If a function is
meant to be callable by, e.g., `authenticated`, that must be a deliberate,
explicit grant in the same migration — not silence.

This is enforced by `lib/security/function_privilege_convention.test.ts`,
which scans every `.sql` file under `lib/` for a `CREATE FUNCTION` /
`CREATE OR REPLACE FUNCTION` statement and fails if the same file doesn't
also contain matching `REVOKE EXECUTE` / `GRANT EXECUTE` statements for that
function name. A new migration that adds a function without following this
convention will fail that test.

See the "Appendix" section of `lib/security/privilege_hardening_runbook.sql`
for an optional, rollback-only, empirical proof procedure for whether the
schema-wide `ALTER DEFAULT PRIVILEGES` approach is actually effective here —
useful if a later phase wants to establish it as a real default instead of
relying solely on this per-function convention.
