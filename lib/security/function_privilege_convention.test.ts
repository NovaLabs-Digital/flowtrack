import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Guards the convention documented in
// lib/security/FUNCTION_PRIVILEGE_CONVENTION.md: any migration that creates
// a public-schema function must, in that same file, explicitly REVOKE
// EXECUTE from PUBLIC/anon/authenticated and explicitly GRANT it only to
// the roles that need it. This scans every .sql file under lib/ so it
// catches this in ANY future migration, not just this one.

const LIB_ROOT = join(__dirname, "..");

function findSqlFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  let files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules") continue;
      files = files.concat(findSqlFiles(fullPath));
    } else if (
      entry.endsWith(".sql") &&
      /^migration/i.test(entry)
    ) {
      // Only actual migrations (this repo's established naming convention:
      // migration.sql, migration_payment_source.sql, migration_*.sql) are
      // things that can permanently alter production schema and so must
      // follow the convention. Runbooks/verification files (e.g.
      // privilege_hardening_runbook.sql) may create-and-immediately-drop a
      // throwaway function inside a rolled-back transaction purely to prove
      // a point — that isn't a persisted object and doesn't need its own
      // access policy.
      files.push(fullPath);
    }
  }
  return files;
}

function extractCreatedFunctionNames(sql: string): string[] {
  const matches = sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[a-zA-Z_][a-zA-Z0-9_]*\.)?[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi
  );
  const names = new Set<string>();
  for (const m of matches) {
    // Normalize away a schema prefix (e.g. "public.handle_new_user" -> "handle_new_user")
    const raw = m[1];
    const unqualified = raw.includes(".") ? raw.split(".").pop()! : raw;
    names.add(unqualified);
  }
  return [...names];
}

describe("function privilege convention: every CREATE FUNCTION migration is self-contained", () => {
  const sqlFiles = findSqlFiles(LIB_ROOT);

  it("found at least the known existing migration SQL files (sanity check the scan itself works)", () => {
    const relativePaths = sqlFiles.map((f) => relative(LIB_ROOT, f));
    expect(relativePaths.some((p) => p.includes("migration_privilege_hardening.sql"))).toBe(true);
  });

  for (const file of sqlFiles) {
    const relativePath = relative(LIB_ROOT, file);
    it(`${relativePath}: any CREATE FUNCTION is paired with explicit REVOKE/GRANT EXECUTE in the same file`, () => {
      const sql = readFileSync(file, "utf-8");
      const createdFunctions = extractCreatedFunctionNames(sql);

      for (const name of createdFunctions) {
        // Schema prefix may be any schema (e.g. "public." or
        // "flowtrack_private."), or omitted entirely — the convention
        // applies regardless of which schema the function lives in.
        const revokePattern = new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION[S]?\\s+(?:\\w+\\.)?${name}\\b`,
          "i"
        );
        const grantPattern = new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[S]?\\s+(?:\\w+\\.)?${name}\\b`,
          "i"
        );

        expect(
          revokePattern.test(sql),
          `${relativePath}: CREATE FUNCTION ${name} found with no matching REVOKE EXECUTE for it in the same file. See lib/security/FUNCTION_PRIVILEGE_CONVENTION.md.`
        ).toBe(true);
        expect(
          grantPattern.test(sql),
          `${relativePath}: CREATE FUNCTION ${name} found with no matching GRANT EXECUTE for it in the same file. See lib/security/FUNCTION_PRIVILEGE_CONVENTION.md.`
        ).toBe(true);
      }
    });
  }
});

describe("function privilege convention: existing handle_new_user hardening follows the same pattern", () => {
  it("migration_privilege_hardening.sql itself revokes-then-grants EXECUTE explicitly, even though it doesn't CREATE the function", () => {
    const sql = readFileSync(
      join(LIB_ROOT, "security", "migration_privilege_hardening.sql"),
      "utf-8"
    );
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.handle_new_user\(\) TO supabase_auth_admin;/);
  });
});
