import { describe, expect, it, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  toEligibleMember,
  findActiveMembers,
  ensureLaunchCohortRows,
  hasWelcomeBeenSent,
  findCandidateRows,
  claimAndSend,
  countSuppressedRows,
  suppressUpcomingLaunchCohortEmails,
} from "./service";
import { buildLaunchCohortEmailIdempotencyKey } from "./eligibility";
import * as daily from "../daily-companion";

vi.mock("../daily-companion", async () => {
  const actual = await vi.importActual<typeof import("../daily-companion")>("../daily-companion");
  return {
    ...actual,
    sendEmail: vi.fn(),
  };
});

// --- a minimal chainable/thenable query-builder mock, matching only the
// methods this service actually calls, resolving like the real supabase-js
// builder does when awaited directly. Mirrors
// lib/lifecycle-emails/service.test.ts's own mock exactly. ---
function makeQueryResult(result: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "lte", "limit", "not", "is", "update", "upsert"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  (chain as unknown as { then: unknown }).then = (
    resolve: (v: typeof result) => void,
    reject?: (e: unknown) => void
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeSupabaseAdminMock(overrides: {
  fromResult?: { data: unknown; error: unknown; count?: number | null };
  rpcResults?: Record<string, { data: unknown; error: unknown }>;
  getUserByIdResult?: { data: unknown; error: unknown };
} = {}) {
  const fromResult = overrides.fromResult ?? { data: [], error: null };
  const rpcResults = overrides.rpcResults ?? {};
  const rpc = vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: null, error: null }));
  const from = vi.fn(() => makeQueryResult(fromResult));
  const getUserById = vi.fn(() =>
    Promise.resolve(overrides.getUserByIdResult ?? { data: { user: null }, error: null })
  );
  return {
    from,
    rpc,
    auth: { admin: { getUserById } },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-01T00:00:00Z",
    email: "jordan@example.com",
    email_confirmed_at: "2026-09-01T00:05:00Z",
    ...overrides,
  } as User;
}

describe("buildLaunchCohortEmailIdempotencyKey: derives only from the immutable row id", () => {
  it("produces the exact documented key shape", () => {
    expect(buildLaunchCohortEmailIdempotencyKey("row-1")).toBe("flowtrack-launch-cohort/row-1");
  });
});

describe("toEligibleMember", () => {
  it("returns null when email is missing", () => {
    expect(toEligibleMember(makeUser({ email: undefined }))).toBeNull();
  });

  it("returns null when email_confirmed_at is missing (unconfirmed)", () => {
    expect(toEligibleMember(makeUser({ email_confirmed_at: undefined }))).toBeNull();
  });

  it("extracts full_name from user_metadata when present", () => {
    const result = toEligibleMember(makeUser({ user_metadata: { full_name: "Jordan Rivera" } }));
    expect(result?.fullName).toBe("Jordan Rivera");
  });

  it("falls back to null name when user_metadata.full_name is absent/blank", () => {
    expect(toEligibleMember(makeUser({ user_metadata: {} }))?.fullName).toBeNull();
    expect(toEligibleMember(makeUser({ user_metadata: { full_name: "   " } }))?.fullName).toBeNull();
  });

  it("never trusts a non-string full_name", () => {
    expect(toEligibleMember(makeUser({ user_metadata: { full_name: 12345 } }))?.fullName).toBeNull();
  });

  it("has no account-age/cutoff gate — eligibility is decided entirely by roster enrollment, never account creation time", () => {
    // A user created years ago is just as eligible as one created
    // yesterday: the only thing that matters is whether they're on the
    // roster (findActiveMembers), which this function has no knowledge of.
    const ancient = toEligibleMember(makeUser({ created_at: "2015-01-01T00:00:00Z" }));
    expect(ancient).not.toBeNull();
  });
});

describe("findActiveMembers: reads only the not-suppressed roster, never all of auth.users", () => {
  it("filters to suppressed_at IS NULL", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ user_id: "user-1" }], error: null } });
    await findActiveMembers(admin);
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.is).toHaveBeenCalledWith("suppressed_at", null);
  });

  it("queries launch_cohort_members, not lifecycle_emails or auth.users directly", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [], error: null } });
    await findActiveMembers(admin);
    expect(admin.from).toHaveBeenCalledWith("launch_cohort_members");
  });

  it("scopes to exactly one user_id in single-user test mode", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ user_id: "user-1" }], error: null } });
    await findActiveMembers(admin, { userId: "user-1" });
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("does not scope by user when none is given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [], error: null } });
    await findActiveMembers(admin);
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).not.toHaveBeenCalled();
  });

  it("throws (does not silently swallow) on a query error", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: { message: "db unavailable" } } });
    await expect(findActiveMembers(admin)).rejects.toThrow(/db unavailable/);
  });
});

describe("ensureLaunchCohortRows: rollout configuration fails closed", () => {
  it("creates nothing when campaignStart is null — a deploy sends zero launch-cohort emails by default", async () => {
    const admin = makeSupabaseAdminMock();
    const member = toEligibleMember(makeUser())!;
    const result = await ensureLaunchCohortRows(admin, member, null);
    expect(result.created).toBe(0);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("upserts exactly four rows (welcome/story/routine/checkin) once campaignStart is configured", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], error: null } });
    const member = toEligibleMember(makeUser())!;
    const campaignStart = new Date("2026-10-01T00:00:00Z");
    const result = await ensureLaunchCohortRows(admin, member, campaignStart);

    expect(admin.from).toHaveBeenCalledWith("launch_cohort_emails");
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.upsert).toHaveBeenCalledTimes(1);
    const [rows, upsertOptions] = fromReturn.upsert.mock.calls[0];
    expect(rows).toHaveLength(4);
    expect(rows.map((r: { email_type: string }) => r.email_type).sort()).toEqual(
      ["checkin", "routine", "story", "welcome"].sort()
    );
    expect(upsertOptions).toEqual({ onConflict: "user_id,email_type", ignoreDuplicates: true });
    expect(result.created).toBe(4);
  });

  it("every row's eligible_at is anchored to campaignStart, never to the member's own account-creation time", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], error: null } });
    // A member whose account was created long before campaignStart.
    const member = toEligibleMember(makeUser({ created_at: "2015-01-01T00:00:00Z" }))!;
    const campaignStart = new Date("2026-10-01T00:00:00Z");
    await ensureLaunchCohortRows(admin, member, campaignStart);

    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [rows] = fromReturn.upsert.mock.calls[0];
    const welcomeRow = rows.find((r: { email_type: string }) => r.email_type === "welcome");
    expect(welcomeRow.eligible_at).toBe(campaignStart.toISOString());
  });

  it("throws (does not silently swallow) when the upsert itself errors", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: { message: "db unavailable" } } });
    const member = toEligibleMember(makeUser())!;
    await expect(ensureLaunchCohortRows(admin, member, new Date("2026-10-01"))).rejects.toThrow(/db unavailable/);
  });
});

describe("hasWelcomeBeenSent", () => {
  it("is true only when status is exactly 'sent'", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: { status: "sent" }, error: null } });
    expect(await hasWelcomeBeenSent(admin, "user-1")).toBe(true);
  });

  it("is false for pending/failed/processing/suppressed/exhausted", async () => {
    for (const status of ["pending", "failed", "processing", "suppressed", "exhausted"]) {
      const admin = makeSupabaseAdminMock({ fromResult: { data: { status }, error: null } });
      expect(await hasWelcomeBeenSent(admin, "user-1")).toBe(false);
    }
  });

  it("fails closed (false) on a lookup error or missing row", async () => {
    const adminError = makeSupabaseAdminMock({ fromResult: { data: null, error: { message: "boom" } } });
    expect(await hasWelcomeBeenSent(adminError, "user-1")).toBe(false);

    const adminMissing = makeSupabaseAdminMock({ fromResult: { data: null, error: null } });
    expect(await hasWelcomeBeenSent(adminMissing, "user-1")).toBe(false);
  });
});

describe("findCandidateRows", () => {
  it("filters to non-terminal statuses and eligible_at <= now, and scopes by userId when given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [], error: null } });
    await findCandidateRows(admin, { userId: "user-1" });

    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.in).toHaveBeenCalledWith("status", ["pending", "failed", "processing"]);
    expect(fromReturn.lte).toHaveBeenCalledWith("eligible_at", expect.any(String));
    expect(fromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("queries launch_cohort_emails specifically", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [], error: null } });
    await findCandidateRows(admin);
    expect(admin.from).toHaveBeenCalledWith("launch_cohort_emails");
  });
});

describe("claimAndSend", () => {
  const candidate = { id: "row-1", user_id: "user-1", email_type: "welcome" as const };

  beforeEach(() => {
    vi.mocked(daily.sendEmail).mockReset();
  });

  it("dryRun never claims and never sends — nothing sends by default even once a cron run happens", async () => {
    const admin = makeSupabaseAdminMock();
    const result = await claimAndSend(admin, candidate, { dryRun: true });
    expect(result).toEqual({ outcome: "skipped", reason: "not_claimed" });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(daily.sendEmail).not.toHaveBeenCalled();
  });

  it("returns skipped/not_claimed when the claim RPC returns zero rows — this is how duplicate sends across overlapping cron runs are prevented", async () => {
    const admin = makeSupabaseAdminMock({ rpcResults: { claim_launch_cohort_email: { data: [], error: null } } });
    const result = await claimAndSend(admin, candidate);
    expect(result).toEqual({ outcome: "skipped", reason: "not_claimed" });
    expect(daily.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses to send story before welcome has been sent, and records a failed attempt", async () => {
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-2", user_id: "user-1", email_type: "story", claim_token: "tok-1" }],
          error: null,
        },
      },
      fromResult: { data: { status: "pending" }, error: null }, // welcome not sent
    });
    const result = await claimAndSend(admin, { id: "row-2", user_id: "user-1", email_type: "story" });
    expect(result).toEqual({ outcome: "skipped", reason: "welcome_prerequisite_not_met" });
    expect(daily.sendEmail).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_launch_cohort_email",
      expect.objectContaining({ p_id: "row-2", p_claim_token: "tok-1", p_status: "failed" })
    );
  });

  it("sends the welcome email on a successful claim, using the launch-cohort idempotency key, and completes with status=sent", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: true, id: "resend-msg-1" });
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-abc" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });

    const result = await claimAndSend(admin, candidate);

    expect(result).toEqual({ outcome: "sent", providerMessageId: "resend-msg-1" });
    expect(daily.sendEmail).toHaveBeenCalledTimes(1);
    const [, sendOptions] = vi.mocked(daily.sendEmail).mock.calls[0];
    expect(sendOptions?.idempotencyKey).toBe(buildLaunchCohortEmailIdempotencyKey("row-1"));
    expect(sendOptions?.idempotencyKey).toBe("flowtrack-launch-cohort/row-1");
    // Must never contain the claim token — only the immutable row id.
    expect(sendOptions?.idempotencyKey).not.toContain("tok-abc");
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_launch_cohort_email",
      expect.objectContaining({ p_id: "row-1", p_claim_token: "tok-abc", p_status: "sent", p_provider_message_id: "resend-msg-1" })
    );
  });

  it("a retry of the same row with a DIFFERENT claim_token still produces the same provider idempotency key", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: true, id: "msg-1" });

    const firstAttempt = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-first" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(firstAttempt, candidate);
    const firstKey = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;
    vi.mocked(daily.sendEmail).mockClear();

    const secondAttempt = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-second-after-reclaim" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(secondAttempt, candidate);
    const secondKey = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;

    expect(firstKey).toBe(secondKey);
  });

  it("skips (does not send) when the live user lookup shows an unconfirmed/missing user", async () => {
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-abc" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser({ email_confirmed_at: undefined }) }, error: null },
      fromResult: { data: { attempt_count: 1 }, error: null },
    });

    const result = await claimAndSend(admin, candidate);
    expect(result.outcome === "failed" || result.outcome === "exhausted").toBe(true);
    expect(daily.sendEmail).not.toHaveBeenCalled();
  });

  it("marks exhausted (not failed) once attempt_count has reached MAX_ATTEMPTS", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: false, error: "smtp timeout" });
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-abc" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
      fromResult: { data: { attempt_count: 4 }, error: null },
    });

    const result = await claimAndSend(admin, candidate);
    expect(result).toEqual({ outcome: "exhausted" });
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_launch_cohort_email",
      expect.objectContaining({ p_status: "exhausted", p_next_attempt_at: null })
    );
  });

  it("truncates an overly long error message before recording it", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: false, error: "x".repeat(1000) });
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_launch_cohort_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-abc" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
      fromResult: { data: { attempt_count: 1 }, error: null },
    });

    await claimAndSend(admin, candidate);
    const call = vi.mocked(admin.rpc).mock.calls.find((c) => c[0] === "complete_launch_cohort_email");
    const lastErrorArg = (call?.[1] as { p_last_error?: string })?.p_last_error ?? "";
    expect(lastErrorArg.length).toBeLessThanOrEqual(300);
  });
});

describe("countSuppressedRows: real, scope-aware observability count", () => {
  it("reports zero when there are no suppressed rows", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 0 } });
    expect(await countSuppressedRows(admin)).toBe(0);
  });

  it("scopes to exactly one user when userId is given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 1 } });
    await countSuppressedRows(admin, { userId: "user-1" });
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).toHaveBeenCalledWith("status", "suppressed");
    expect(fromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("treats a null count from the driver as zero rather than throwing", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: null } });
    expect(await countSuppressedRows(admin)).toBe(0);
  });

  it("throws (does not silently swallow) on a query error", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: { message: "db unavailable" }, count: null } });
    await expect(countSuppressedRows(admin)).rejects.toThrow(/db unavailable/);
  });
});

describe("suppressUpcomingLaunchCohortEmails: deliberate, per-user, never by email — updates BOTH the per-email rows and the roster row", () => {
  it("filters by exact user_id, ALL FOUR email types, and excludes already-sent/suppressed rows", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }], error: null } });
    const result = await suppressUpcomingLaunchCohortEmails(admin, "user-1", "user_replied_stop");

    expect(admin.from).toHaveBeenCalledWith("launch_cohort_emails");
    const emailsCallIndex = (admin.from as ReturnType<typeof vi.fn>).mock.calls.findIndex((c) => c[0] === "launch_cohort_emails");
    const emailsFromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[emailsCallIndex].value;
    expect(emailsFromReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "suppressed", suppression_reason: "user_replied_stop" })
    );
    expect(emailsFromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(emailsFromReturn.in).toHaveBeenCalledWith("email_type", ["welcome", "story", "routine", "checkin"]);
    expect(emailsFromReturn.not).toHaveBeenCalledWith("status", "in", "(sent,suppressed)");
    expect(result.suppressed).toBe(1);
  });

  it("also marks the roster row (launch_cohort_members) suppressed, so a later enrollment-sync can never recreate rows for this member", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }], error: null } });
    await suppressUpcomingLaunchCohortEmails(admin, "user-1", "user_replied_stop");

    expect(admin.from).toHaveBeenCalledWith("launch_cohort_members");
    const membersCallIndex = (admin.from as ReturnType<typeof vi.fn>).mock.calls.findIndex((c) => c[0] === "launch_cohort_members");
    const membersFromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[membersCallIndex].value;
    expect(membersFromReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({ suppression_reason: "user_replied_stop" })
    );
    expect(membersFromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
