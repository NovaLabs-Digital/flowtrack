import { describe, expect, it } from "vitest";
import {
  getVerifiedTotpFactors,
  getUnverifiedTotpFactors,
  hasVerifiedTotpFactor,
  isLastVerifiedTotpFactor,
  type MfaFactor,
} from "./factors";

const verified1: MfaFactor = { id: "f1", factor_type: "totp", status: "verified" };
const verified2: MfaFactor = { id: "f2", factor_type: "totp", status: "verified" };
const unverified: MfaFactor = { id: "f3", factor_type: "totp", status: "unverified" };
const otherType: MfaFactor = { id: "f4", factor_type: "phone", status: "verified" } as MfaFactor;
const verifiedPhone: MfaFactor = { id: "f5", factor_type: "phone", status: "verified" };
const verifiedWebauthn: MfaFactor = { id: "f6", factor_type: "webauthn", status: "verified" };
const unverifiedTotp: MfaFactor = { id: "f7", factor_type: "totp", status: "unverified" };

describe("getVerifiedTotpFactors / getUnverifiedTotpFactors", () => {
  it("filters to only verified TOTP factors", () => {
    expect(getVerifiedTotpFactors([verified1, unverified, otherType])).toEqual([verified1]);
  });

  it("filters to only unverified TOTP factors", () => {
    expect(getUnverifiedTotpFactors([verified1, unverified, otherType])).toEqual([unverified]);
  });

  it("returns an empty array when there are none", () => {
    expect(getVerifiedTotpFactors([])).toEqual([]);
    expect(getUnverifiedTotpFactors([otherType])).toEqual([]);
  });
});

describe("hasVerifiedTotpFactor", () => {
  it("is false for a non-enrolled user", () => {
    expect(hasVerifiedTotpFactor([])).toBe(false);
    expect(hasVerifiedTotpFactor([unverified])).toBe(false);
  });

  it("is true once at least one factor is verified", () => {
    expect(hasVerifiedTotpFactor([verified1])).toBe(true);
  });
});

describe("isLastVerifiedTotpFactor", () => {
  it("is true when exactly one verified factor exists and matches", () => {
    expect(isLastVerifiedTotpFactor([verified1, unverified], "f1")).toBe(true);
  });

  it("is false when a second verified factor exists", () => {
    expect(isLastVerifiedTotpFactor([verified1, verified2], "f1")).toBe(false);
  });

  it("is false when the given id is not the verified one", () => {
    expect(isLastVerifiedTotpFactor([verified1], "f-not-real")).toBe(false);
  });

  it("is false when there are no verified factors at all", () => {
    expect(isLastVerifiedTotpFactor([unverified], "f3")).toBe(false);
  });
});

// FlowTrack Phase 1B supports TOTP only, so "enrolled" is defined
// consistently everywhere in this project (SQL, server API routes, and the
// client challenge/Settings UI) as factor_type = 'totp' AND status =
// 'verified' — never "any verified factor". hasVerifiedTotpFactor() is the
// single shared implementation of that rule reused by both
// lib/mfa/serverAuthorize.ts (server) and app/mfa-challenge/page.tsx +
// app/components/SecuritySettings.tsx (client) — proving it here proves the
// identical rule for both of those layers. The SQL layer implements the
// same rule independently (it cannot share TypeScript code); see
// lib/security/migration_mfa_enforcement.test.ts for the corresponding
// source-content proof that the SQL predicate matches exactly.
describe("Phase 1C cross-layer consistency: TOTP-only enrollment rule", () => {
  it("verified TOTP => enrolled", () => {
    expect(hasVerifiedTotpFactor([verified1])).toBe(true);
  });

  it("unverified TOTP => not enrolled", () => {
    expect(hasVerifiedTotpFactor([unverifiedTotp])).toBe(false);
  });

  it("verified phone => not enrolled for FlowTrack Phase 1C", () => {
    expect(hasVerifiedTotpFactor([verifiedPhone])).toBe(false);
  });

  it("verified WebAuthn => not enrolled for FlowTrack Phase 1C", () => {
    expect(hasVerifiedTotpFactor([verifiedWebauthn])).toBe(false);
  });

  it("mixed factors with one verified TOTP => enrolled", () => {
    expect(hasVerifiedTotpFactor([verifiedPhone, verifiedWebauthn, verified1])).toBe(true);
  });

  it("mixed factors without a verified TOTP => not enrolled", () => {
    expect(hasVerifiedTotpFactor([verifiedPhone, verifiedWebauthn, unverifiedTotp])).toBe(false);
  });
});
