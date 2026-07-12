import { describe, expect, it } from "vitest";
import { getTodayParts, resolveDueOccurrence } from "./date";

describe("getTodayParts", () => {
  it("keeps New York on July 11 while UTC has already rolled to July 12", () => {
    // 2026-07-12T00:30:00Z = 2026-07-11 20:30 EDT (UTC-4)
    const reference = new Date("2026-07-12T00:30:00Z");
    expect(getTodayParts("America/New_York", reference)).toEqual({ year: 2026, month: 7, day: 11 });
  });

  it("puts Tokyo on July 12 while UTC is still July 11", () => {
    // 2026-07-11T16:00:00Z = 2026-07-12 01:00 JST (UTC+9)
    const reference = new Date("2026-07-11T16:00:00Z");
    expect(getTodayParts("Asia/Tokyo", reference)).toEqual({ year: 2026, month: 7, day: 12 });
  });

  it("keeps Los Angeles behind UTC's calendar day", () => {
    // 2026-07-12T03:00:00Z = 2026-07-11 20:00 PDT (UTC-7)
    const reference = new Date("2026-07-12T03:00:00Z");
    expect(getTodayParts("America/Los_Angeles", reference)).toEqual({ year: 2026, month: 7, day: 11 });
  });

  it("applies the correct DST offset for the season instead of a fixed UTC offset", () => {
    // Same UTC wall-clock hour (04:30), one instant in EST (winter, UTC-5),
    // one in EDT (summer, UTC-4) — the resulting Eastern calendar day must differ.
    const winter = getTodayParts("America/New_York", new Date("2026-01-15T04:30:00Z"));
    const summer = getTodayParts("America/New_York", new Date("2026-07-15T04:30:00Z"));
    expect(winter).toEqual({ year: 2026, month: 1, day: 14 }); // EST: 04:30 - 5h = prior day 23:30
    expect(summer).toEqual({ year: 2026, month: 7, day: 15 }); // EDT: 04:30 - 4h = same day 00:30
  });
});

describe("resolveDueOccurrence", () => {
  it("returns dueInDays 1 for due_day 12 when today is the 11th (offset-1 reminder)", () => {
    const result = resolveDueOccurrence(12, { year: 2026, month: 7, day: 11 });
    expect(result).toEqual({ year: 2026, month: 7, day: 12, dueInDays: 1 });
  });

  it("rolls Jan 31 -> Feb 1 instead of reporting 30 days overdue", () => {
    const result = resolveDueOccurrence(1, { year: 2026, month: 1, day: 31 });
    expect(result).toEqual({ year: 2026, month: 2, day: 1, dueInDays: 1 });
  });

  it("rolls Dec 31 -> Jan 1 across a year boundary", () => {
    const result = resolveDueOccurrence(1, { year: 2026, month: 12, day: 31 });
    expect(result).toEqual({ year: 2027, month: 1, day: 1, dueInDays: 1 });
  });

  it("recognizes Feb 29 in a leap year instead of clamping it away", () => {
    const result = resolveDueOccurrence(29, { year: 2028, month: 2, day: 28 });
    expect(result).toEqual({ year: 2028, month: 2, day: 29, dueInDays: 1 });
  });

  it("clamps due_day 31 to the last valid day of a non-leap February (28th), not March", () => {
    const result = resolveDueOccurrence(31, { year: 2026, month: 2, day: 20 });
    expect(result).toEqual({ year: 2026, month: 2, day: 28, dueInDays: 8 });
  });

  it("keeps a genuinely stale bill overdue rather than rolling it to next month", () => {
    const result = resolveDueOccurrence(5, { year: 2026, month: 1, day: 20 });
    expect(result.dueInDays).toBe(-15);
    expect(result.dueInDays < 0).toBe(true);
  });
});
