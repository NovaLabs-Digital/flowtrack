import { describe, expect, it } from "vitest";
import { normalizeTotpCode, isValidTotpCode } from "./totp";

describe("normalizeTotpCode", () => {
  it("strips internal and surrounding whitespace", () => {
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
  });

  it("leaves an already-clean code untouched", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
  });
});

describe("isValidTotpCode", () => {
  it("accepts exactly six digits", () => {
    expect(isValidTotpCode("123456")).toBe(true);
  });

  it("accepts six digits with surrounding/internal whitespace", () => {
    expect(isValidTotpCode(" 123 456 ")).toBe(true);
  });

  it("rejects fewer or more than six digits", () => {
    expect(isValidTotpCode("12345")).toBe(false);
    expect(isValidTotpCode("1234567")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidTotpCode("12345a")).toBe(false);
    expect(isValidTotpCode("123-456")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidTotpCode("")).toBe(false);
  });
});
