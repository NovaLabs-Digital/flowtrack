import { describe, expect, it } from "vitest";
import { sanitizeNextPath, buildNextQueryParam } from "./nextUrl";

describe("sanitizeNextPath: safe paths pass through", () => {
  it("allows a plain same-app path", () => {
    expect(sanitizeNextPath("/dashboard/settings")).toBe("/dashboard/settings");
  });

  it("allows a path with a query string", () => {
    expect(sanitizeNextPath("/dashboard?upgraded=1")).toBe("/dashboard?upgraded=1");
  });

  it("allows a percent-encoded but ultimately safe path", () => {
    expect(sanitizeNextPath("/dashboard%2Fsettings")).toBe("/dashboard/settings");
  });
});

describe("sanitizeNextPath: defaults on missing input", () => {
  it("defaults to /dashboard when next is null/undefined/empty", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
    expect(sanitizeNextPath("")).toBe("/dashboard");
  });

  it("honors a custom fallback", () => {
    expect(sanitizeNextPath(null, "/restore")).toBe("/restore");
  });
});

describe("sanitizeNextPath: rejects unsafe values", () => {
  it("rejects protocol-relative //evil.com", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
  });

  it("rejects a double-encoded protocol-relative URL", () => {
    expect(sanitizeNextPath("/%2F%2Fevil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/%252F%252Fevil.com")).toBe("/dashboard");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/https://evil.com")).toBe("/dashboard");
  });

  it("rejects backslash tricks", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("\\/evil.com")).toBe("/dashboard");
  });

  it("rejects a path that does not start with a single slash", () => {
    expect(sanitizeNextPath("dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("evil.com/dashboard")).toBe("/dashboard");
  });

  it("rejects control characters", () => {
    expect(sanitizeNextPath("/dashboard\x00evil")).toBe("/dashboard");
  });

  it("rejects an undecodable percent sequence", () => {
    expect(sanitizeNextPath("/%E0%A4%A")).toBe("/dashboard");
  });
});

describe("sanitizeNextPath: loop prevention", () => {
  it("rejects /login as a next target", () => {
    expect(sanitizeNextPath("/login")).toBe("/dashboard");
    expect(sanitizeNextPath("/login?foo=bar")).toBe("/dashboard");
  });

  it("rejects /mfa-challenge as a next target", () => {
    expect(sanitizeNextPath("/mfa-challenge")).toBe("/dashboard");
    expect(sanitizeNextPath("/mfa-challenge/foo")).toBe("/dashboard");
  });

  it("does not reject a path that merely starts with the same prefix text", () => {
    expect(sanitizeNextPath("/loginhistory")).toBe("/loginhistory");
  });
});

describe("buildNextQueryParam", () => {
  it("produces an encoded next= param from a sanitized path", () => {
    expect(buildNextQueryParam("/dashboard/settings")).toBe(
      "next=%2Fdashboard%2Fsettings"
    );
  });

  it("falls back to /dashboard for an unsafe path", () => {
    expect(buildNextQueryParam("//evil.com")).toBe("next=%2Fdashboard");
  });
});
