import { describe, expect, it } from "vitest";
import {
  parseSignupEmailsStartAt,
  isEligibleByCutoff,
  computeEligibleAt,
  computeNextAttempt,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
} from "./eligibility";

describe("parseSignupEmailsStartAt: fails closed on anything not a valid ISO timestamp", () => {
  it("returns null for undefined/null/empty", () => {
    expect(parseSignupEmailsStartAt(undefined)).toBeNull();
    expect(parseSignupEmailsStartAt(null)).toBeNull();
    expect(parseSignupEmailsStartAt("")).toBeNull();
    expect(parseSignupEmailsStartAt("   ")).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(parseSignupEmailsStartAt("not-a-date")).toBeNull();
    expect(parseSignupEmailsStartAt("2026-13-99")).toBeNull();
  });

  it("parses a valid ISO-8601 timestamp", () => {
    const parsed = parseSignupEmailsStartAt("2026-09-10T00:00:00Z");
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("never defaults to the epoch, current time, or any implicit fallback", () => {
    // A garbage value must not coincidentally resolve to a "real" date.
    const parsed = parseSignupEmailsStartAt("garbage");
    expect(parsed).toBeNull();
  });
});

describe("isEligibleByCutoff: fails closed when the cutoff itself is null", () => {
  it("is never eligible when cutoff is null, regardless of account age", () => {
    expect(isEligibleByCutoff(new Date("2026-01-01"), null)).toBe(false);
    expect(isEligibleByCutoff(new Date(), null)).toBe(false);
  });

  it("is eligible when the account was created on or after the cutoff", () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    expect(isEligibleByCutoff(new Date("2026-09-01T00:00:00Z"), cutoff)).toBe(true);
    expect(isEligibleByCutoff(new Date("2026-09-02T00:00:00Z"), cutoff)).toBe(true);
  });

  it("is not eligible for an account created before the cutoff", () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    expect(isEligibleByCutoff(new Date("2026-08-31T23:59:59Z"), cutoff)).toBe(false);
  });
});

describe("computeEligibleAt: anchored to confirmed-signup time, not account creation", () => {
  const confirmedAt = new Date("2026-09-01T12:00:00Z");

  it("welcome is eligible immediately at confirmation", () => {
    expect(computeEligibleAt("welcome", confirmedAt).toISOString()).toBe(
      confirmedAt.toISOString()
    );
  });

  it("feedback_48h is eligible exactly 48 hours after confirmation", () => {
    expect(computeEligibleAt("feedback_48h", confirmedAt).toISOString()).toBe(
      "2026-09-03T12:00:00.000Z"
    );
  });

  it("checkin_7d is eligible exactly 7 days after confirmation", () => {
    expect(computeEligibleAt("checkin_7d", confirmedAt).toISOString()).toBe(
      "2026-09-08T12:00:00.000Z"
    );
  });
});

describe("computeNextAttempt: bounded backoff, then exhaustion", () => {
  const from = new Date("2026-09-01T00:00:00Z");

  it("schedules increasing backoff for each of the first MAX_ATTEMPTS - 1 failures", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const next = computeNextAttempt(attempt, from);
      expect(next).not.toBeNull();
      const expectedMinutes =
        RETRY_BACKOFF_MINUTES[Math.min(attempt - 1, RETRY_BACKOFF_MINUTES.length - 1)];
      expect(next!.getTime() - from.getTime()).toBe(expectedMinutes * 60 * 1000);
    }
  });

  it("returns null once attemptCount reaches MAX_ATTEMPTS — callers must treat this as exhausted", () => {
    expect(computeNextAttempt(MAX_ATTEMPTS, from)).toBeNull();
    expect(computeNextAttempt(MAX_ATTEMPTS + 1, from)).toBeNull();
  });

  it("backoff strictly increases across attempts", () => {
    const first = computeNextAttempt(1, from)!.getTime();
    const second = computeNextAttempt(2, from)!.getTime();
    const third = computeNextAttempt(3, from)!.getTime();
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });
});
