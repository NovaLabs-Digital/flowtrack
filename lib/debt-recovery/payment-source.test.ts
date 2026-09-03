import { describe, expect, it } from "vitest";
import {
  normalizePaymentSourceType,
  normalizePaymentSourceName,
  normalizePaymentSourceLast4,
  validatePaymentSourcePair,
} from "./payment-source";

describe("normalizePaymentSourceType", () => {
  it("accepts bank_account", () => {
    expect(normalizePaymentSourceType("bank_account")).toBe("bank_account");
  });

  it("accepts credit_card", () => {
    expect(normalizePaymentSourceType("credit_card")).toBe("credit_card");
  });

  it("accepts other", () => {
    expect(normalizePaymentSourceType("other")).toBe("other");
  });

  it("rejects an unrecognized string as null", () => {
    expect(normalizePaymentSourceType("crypto_wallet")).toBeNull();
  });

  it("treats empty string as null (not specified)", () => {
    expect(normalizePaymentSourceType("")).toBeNull();
  });

  it("treats non-string input as null", () => {
    expect(normalizePaymentSourceType(undefined)).toBeNull();
    expect(normalizePaymentSourceType(null)).toBeNull();
  });
});

describe("normalizePaymentSourceName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizePaymentSourceName("  Chase Checking  ")).toEqual({ value: "Chase Checking" });
  });

  it("returns null for an empty or whitespace-only name", () => {
    expect(normalizePaymentSourceName("")).toEqual({ value: null });
    expect(normalizePaymentSourceName("   ")).toEqual({ value: null });
  });

  it("returns null for non-string input", () => {
    expect(normalizePaymentSourceName(undefined)).toEqual({ value: null });
  });

  it("caps length at 80 characters so an absurdly long value can't be stored", () => {
    const long = "A".repeat(200);
    const result = normalizePaymentSourceName(long);
    expect(result.value).toHaveLength(80);
  });

  it("allows legitimate names with a single digit", () => {
    expect(normalizePaymentSourceName("Visa 2")).toEqual({ value: "Visa 2" });
  });

  it("allows legitimate names with up to four total digits", () => {
    expect(normalizePaymentSourceName("Bank 1 Checking")).toEqual({ value: "Bank 1 Checking" });
    expect(normalizePaymentSourceName("Business 401k")).toEqual({ value: "Business 401k" });
  });

  it("rejects a full card number disguised as a name", () => {
    const result = normalizePaymentSourceName("Chase 123456789");
    expect(result.value).toBeNull();
    expect(result.error).toBe(
      "Enter only the account or card name here. Put the last four digits in the separate field."
    );
  });

  it("rejects a formatted/spaced full card number in the name", () => {
    const result = normalizePaymentSourceName("Visa 4111 1111 1111 1111");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects a nine-digit routing-style number in the name", () => {
    const result = normalizePaymentSourceName("Account 1234-5678-9012");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects a bare 9-digit routing number with no other text", () => {
    const result = normalizePaymentSourceName("123456789");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("accepts exactly four total digits at the boundary", () => {
    expect(normalizePaymentSourceName("Account 1234")).toEqual({ value: "Account 1234" });
  });

  it("rejects five total digits, one past the boundary", () => {
    const result = normalizePaymentSourceName("Account 12345");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("normalizePaymentSourceLast4", () => {
  it("accepts exactly four numeric digits", () => {
    expect(normalizePaymentSourceLast4("1234")).toEqual({ value: "1234" });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(normalizePaymentSourceLast4("  5678 ")).toEqual({ value: "5678" });
  });

  it("treats an empty value as absent, not invalid", () => {
    expect(normalizePaymentSourceLast4("")).toEqual({ value: null });
    expect(normalizePaymentSourceLast4(undefined)).toEqual({ value: null });
  });

  it("rejects fewer than four digits", () => {
    const result = normalizePaymentSourceLast4("123");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects more than four digits", () => {
    const result = normalizePaymentSourceLast4("12345");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects a full card-number-shaped value", () => {
    const result = normalizePaymentSourceLast4("4111111111111111");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects non-numeric characters", () => {
    const result = normalizePaymentSourceLast4("12ab");
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("validatePaymentSourcePair", () => {
  it("rejects last4 present without a name (orphaned last4)", () => {
    const error = validatePaymentSourcePair(null, "1234");
    expect(error).toBeTruthy();
  });

  it("allows a name with no last4", () => {
    expect(validatePaymentSourcePair("Chase Checking", null)).toBeNull();
  });

  it("allows both name and last4 together", () => {
    expect(validatePaymentSourcePair("Chase Checking", "1234")).toBeNull();
  });

  it("allows neither field (legacy bill, no payment source at all)", () => {
    expect(validatePaymentSourcePair(null, null)).toBeNull();
  });
});
