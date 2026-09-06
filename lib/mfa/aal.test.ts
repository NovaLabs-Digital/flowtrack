import { describe, expect, it } from "vitest";
import { decideAalAction, isProtectedContentReady } from "./aal";

describe("decideAalAction", () => {
  it("routes to login when there is no session", () => {
    expect(
      decideAalAction({ hasSession: false, currentLevel: null, nextLevel: null })
    ).toBe("login");
  });

  it("routes to login when levels are missing despite hasSession true", () => {
    expect(
      decideAalAction({ hasSession: true, currentLevel: null, nextLevel: "aal1" })
    ).toBe("login");
    expect(
      decideAalAction({ hasSession: true, currentLevel: "aal1", nextLevel: null })
    ).toBe("login");
  });

  it("continues for a non-enrolled user (aal1 -> aal1)", () => {
    expect(
      decideAalAction({ hasSession: true, currentLevel: "aal1", nextLevel: "aal1" })
    ).toBe("continue");
  });

  it("challenges an enrolled user who has not completed MFA yet (aal1 -> aal2)", () => {
    expect(
      decideAalAction({ hasSession: true, currentLevel: "aal1", nextLevel: "aal2" })
    ).toBe("challenge");
  });

  it("continues for a fully verified user (aal2 -> aal2)", () => {
    expect(
      decideAalAction({ hasSession: true, currentLevel: "aal2", nextLevel: "aal2" })
    ).toBe("continue");
  });

  it("requires reverification for a stale downgrade (aal2 -> aal1)", () => {
    expect(
      decideAalAction({ hasSession: true, currentLevel: "aal2", nextLevel: "aal1" })
    ).toBe("reverify");
  });
});

describe("isProtectedContentReady", () => {
  it("is true only for 'continue'", () => {
    expect(isProtectedContentReady("continue")).toBe(true);
    expect(isProtectedContentReady("login")).toBe(false);
    expect(isProtectedContentReady("challenge")).toBe(false);
    expect(isProtectedContentReady("reverify")).toBe(false);
    expect(isProtectedContentReady(null)).toBe(false);
  });
});
