import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "migration_payment_source.sql"), "utf-8");

describe("payment source migration: non-destructive column additions", () => {
  it("adds all three columns idempotently and nullable (legacy rows stay valid)", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS payment_source_type TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS payment_source_name TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS payment_source_last4 TEXT");
    // No NOT NULL / DEFAULT on any of the three — every existing row keeps
    // working unchanged with these columns simply absent/null.
    expect(sql).not.toMatch(/payment_source_\w+ TEXT NOT NULL/);
    expect(sql).not.toMatch(/payment_source_\w+ TEXT DEFAULT/);
  });

  it("never drops or alters an existing column or table", () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });
});

describe("payment source migration: idempotent constraint creation", () => {
  it("guards every ADD CONSTRAINT with an existence check so re-running is safe", () => {
    const constraintNames = [
      "debts_payment_source_type_check",
      "debts_payment_source_last4_format_check",
      "debts_payment_source_name_length_check",
      "debts_payment_source_name_digit_check",
      "debts_payment_source_last4_requires_name_check",
    ];
    for (const name of constraintNames) {
      expect(sql).toContain(`conname = '${name}'`);
      expect(sql).toContain(`ADD CONSTRAINT ${name}`);
    }
  });
});

describe("payment source migration: equivalent app-layer protections in SQL", () => {
  it("caps payment_source_name at 80 characters when non-null", () => {
    expect(sql).toMatch(/payment_source_name IS NULL OR char_length\(payment_source_name\) <= 80/);
  });

  it("strips non-numeric characters from the name and caps remaining digits at 4", () => {
    expect(sql).toMatch(
      /char_length\(regexp_replace\(payment_source_name, '\\D', '', 'g'\)\) <= 4/
    );
  });

  it("enforces last4 is exactly four numeric digits when present", () => {
    expect(sql).toContain("payment_source_last4 ~ '^[0-9]{4}$'");
  });

  it("enforces payment_source_type is one of the three allowed values", () => {
    expect(sql).toContain("payment_source_type IN ('bank_account', 'credit_card', 'other')");
  });

  it("rejects an orphaned last4 by requiring a non-empty name whenever last4 is set", () => {
    expect(sql).toMatch(/payment_source_last4 IS NULL\s*\n\s*OR \(payment_source_name IS NOT NULL AND btrim\(payment_source_name\) <> ''\)/);
  });
});
