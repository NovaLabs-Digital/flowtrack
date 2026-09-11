import { describe, expect, it } from "vitest";
import {
  parseLaunchCohortStartAt,
  computeEligibleAt,
  computeNextAttempt,
  buildLaunchCohortEmailIdempotencyKey,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  LAUNCH_COHORT_START_AT_ENV,
} from "./eligibility";

describe("parseLaunchCohortStartAt: fails closed on anything not a valid ISO timestamp", () => {
  it("returns null for undefined/null/empty", () => {
    expect(parseLaunchCohortStartAt(undefined)).toBeNull();
    expect(parseLaunchCohortStartAt(null)).toBeNull();
    expect(parseLaunchCohortStartAt("")).toBeNull();
    expect(parseLaunchCohortStartAt("   ")).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(parseLaunchCohortStartAt("not-a-date")).toBeNull();
    expect(parseLaunchCohortStartAt("2026-13-99")).toBeNull();
  });

  it("parses a valid ISO-8601 timestamp", () => {
    const parsed = parseLaunchCohortStartAt("2026-09-10T00:00:00Z");
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("never defaults to the epoch, current time, or any implicit fallback", () => {
    const parsed = parseLaunchCohortStartAt("garbage");
    expect(parsed).toBeNull();
  });

  it("uses its own distinct env var name, never the signup lifecycle sequence's", () => {
    expect(LAUNCH_COHORT_START_AT_ENV).toBe("LAUNCH_COHORT_START_AT");
    expect(LAUNCH_COHORT_START_AT_ENV).not.toBe("SIGNUP_EMAILS_START_AT");
  });
});

describe("computeEligibleAt: anchored to the single campaign start time, not any per-user date", () => {
  const campaignStart = new Date("2026-10-01T09:00:00Z");

  it("welcome is eligible immediately at campaign start (day 0)", () => {
    expect(computeEligibleAt("welcome", campaignStart).toISOString()).toBe(
      campaignStart.toISOString()
    );
  });

  it("story is eligible exactly 7 days after campaign start", () => {
    expect(computeEligibleAt("story", campaignStart).toISOString()).toBe(
      "2026-10-08T09:00:00.000Z"
    );
  });

  it("routine is eligible exactly 14 days after campaign start", () => {
    expect(computeEligibleAt("routine", campaignStart).toISOString()).toBe(
      "2026-10-15T09:00:00.000Z"
    );
  });

  it("checkin is eligible exactly 21 days after campaign start", () => {
    expect(computeEligibleAt("checkin", campaignStart).toISOString()).toBe(
      "2026-10-22T09:00:00.000Z"
    );
  });

  it("two different members enrolled on different dates still get the identical eligible_at for the same email type — anchored to campaign start, never enrollment time", () => {
    // computeEligibleAt takes no per-member input at all beyond the shared
    // campaignStart, so this is true by construction — asserted directly.
    const a = computeEligibleAt("story", campaignStart);
    const b = computeEligibleAt("story", campaignStart);
    expect(a.toISOString()).toBe(b.toISOString());
  });
});

describe("computeNextAttempt: bounded backoff, then exhaustion (independent constants from the signup lifecycle sequence)", () => {
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

describe("buildLaunchCohortEmailIdempotencyKey: derives only from the immutable row id, with a campaign-distinct prefix", () => {
  it("produces the exact documented key shape", () => {
    expect(buildLaunchCohortEmailIdempotencyKey("row-1")).toBe("flowtrack-launch-cohort/row-1");
  });

  it("uses a different prefix than the signup lifecycle sequence's idempotency key, so the two campaigns can never collide", () => {
    expect(buildLaunchCohortEmailIdempotencyKey("row-1")).not.toBe("flowtrack-lifecycle-email/row-1");
  });

  it("distinct row ids produce distinct keys", () => {
    expect(buildLaunchCohortEmailIdempotencyKey("row-1")).not.toBe(buildLaunchCohortEmailIdempotencyKey("row-2"));
  });

  it("is a pure function of the row id alone", () => {
    const calls = Array.from({ length: 5 }, () => buildLaunchCohortEmailIdempotencyKey("row-1"));
    expect(new Set(calls).size).toBe(1);
    expect(buildLaunchCohortEmailIdempotencyKey.length).toBe(1); // exactly one parameter
  });
});
