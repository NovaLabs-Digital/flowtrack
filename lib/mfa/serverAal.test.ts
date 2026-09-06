import { describe, expect, it } from "vitest";
import { decideServerMfaAccess, isValidAalClaim } from "./serverAal";

describe("isValidAalClaim", () => {
  it("accepts exactly 'aal1' and 'aal2'", () => {
    expect(isValidAalClaim("aal1")).toBe(true);
    expect(isValidAalClaim("aal2")).toBe(true);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    expect(isValidAalClaim(null)).toBe(false);
    expect(isValidAalClaim(undefined)).toBe(false);
    expect(isValidAalClaim("")).toBe(false);
    expect(isValidAalClaim("AAL1")).toBe(false);
    expect(isValidAalClaim("aal3")).toBe(false);
    expect(isValidAalClaim(1)).toBe(false);
    expect(isValidAalClaim({})).toBe(false);
  });
});

describe("decideServerMfaAccess: the four real aal/enrollment combinations", () => {
  it("aal1, not enrolled -> allow", () => {
    expect(decideServerMfaAccess({ currentAal: "aal1", hasVerifiedFactor: false })).toBe(true);
  });

  it("aal1, enrolled -> deny (must step up)", () => {
    expect(decideServerMfaAccess({ currentAal: "aal1", hasVerifiedFactor: true })).toBe(false);
  });

  it("aal2, enrolled -> allow", () => {
    expect(decideServerMfaAccess({ currentAal: "aal2", hasVerifiedFactor: true })).toBe(true);
  });

  it("aal2, not enrolled -> allow (documented stale-after-removal case: the token asserts a higher level than the account currently requires, which is not a security problem)", () => {
    expect(decideServerMfaAccess({ currentAal: "aal2", hasVerifiedFactor: false })).toBe(true);
  });
});

describe("decideServerMfaAccess: invalid/missing AAL always fails closed, regardless of enrollment", () => {
  it("missing claim (null/undefined) denies even a non-enrolled account", () => {
    expect(decideServerMfaAccess({ currentAal: null, hasVerifiedFactor: false })).toBe(false);
    expect(decideServerMfaAccess({ currentAal: undefined, hasVerifiedFactor: false })).toBe(false);
  });

  it("malformed claim denies even a non-enrolled account", () => {
    expect(decideServerMfaAccess({ currentAal: "not-a-real-level", hasVerifiedFactor: false })).toBe(false);
  });

  it("missing/malformed claim denies an enrolled account too", () => {
    expect(decideServerMfaAccess({ currentAal: null, hasVerifiedFactor: true })).toBe(false);
    expect(decideServerMfaAccess({ currentAal: "aal3", hasVerifiedFactor: true })).toBe(false);
  });
});
