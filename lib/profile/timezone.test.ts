import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, resolveTimeZone } from "./timezone";

describe("resolveTimeZone", () => {
  it("falls back to the default for a missing value", () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone("")).toBe(DEFAULT_TIME_ZONE);
  });

  it("falls back to the default for an invalid IANA zone name", () => {
    expect(resolveTimeZone("Not/AZone")).toBe(DEFAULT_TIME_ZONE);
  });

  it("passes through a valid IANA zone name unchanged", () => {
    expect(resolveTimeZone("Europe/London")).toBe("Europe/London");
    expect(resolveTimeZone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("America/Chicago")).toBe("America/Chicago");
  });
});
