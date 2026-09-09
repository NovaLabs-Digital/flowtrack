import { describe, expect, it, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  toEligibleUser,
  ensureLifecycleRows,
  hasWelcomeBeenSent,
  findCandidateRows,
  claimAndSend,
  countSuppressedRows,
  suppressUpcomingLifecycleEmails,
} from "./service";
import { buildLifecycleEmailIdempotencyKey } from "./eligibility";
import * as daily from "../daily-companion";

vi.mock("../daily-companion", async () => {
  const actual = await vi.importActual<typeof import("../daily-companion")>("../daily-companion");
  return {
    ...actual,
    sendEmail: vi.fn(),
  };
});

// --- a minimal chainable/thenable query-builder mock, matching only the
// methods this service actually calls (select/eq/in/lte/limit/not/
// maybeSingle/update/upsert), resolving like the real supabase-js builder
// does when awaited directly. ---
function makeQueryResult(result: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "lte", "limit", "not", "update", "upsert"];
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

describe("buildLifecycleEmailIdempotencyKey: derives only from the immutable row id", () => {
  it("produces the exact documented key shape", () => {
    expect(buildLifecycleEmailIdempotencyKey("row-1")).toBe("flowtrack-lifecycle-email/row-1");
  });

  it("distinct row ids produce distinct keys", () => {
    expect(buildLifecycleEmailIdempotencyKey("row-1")).not.toBe(buildLifecycleEmailIdempotencyKey("row-2"));
  });

  it("is a pure function of the row id alone — same id in, same key out, every time", () => {
    const calls = Array.from({ length: 5 }, () => buildLifecycleEmailIdempotencyKey("row-1"));
    expect(new Set(calls).size).toBe(1);
  });

  it("takes only a row id — there is no attempt-count/claim-token parameter to vary, so simulated attempts 1 through 4 all resolve to the same key", () => {
    const keysAcrossAttempts = [1, 2, 3, 4].map(() => buildLifecycleEmailIdempotencyKey("row-1"));
    expect(new Set(keysAcrossAttempts).size).toBe(1);
    expect(buildLifecycleEmailIdempotencyKey.length).toBe(1); // exactly one parameter
  });
});

describe("claimAndSend: idempotency key survives retries and stale-lease reclaims of the same row", () => {
  beforeEach(() => {
    vi.mocked(daily.sendEmail).mockReset();
  });

  it("a retry of the same row with a DIFFERENT claim_token still produces the same provider idempotency key", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: true, id: "msg-1" });

    const firstAttempt = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-first" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(firstAttempt, { id: "row-1", user_id: "user-1", email_type: "welcome" });
    const firstKey = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;

    vi.mocked(daily.sendEmail).mockClear();

    // Simulates a retry after a stale-lease reclaim: same row id, a brand
    // new (different) claim_token issued by the claim RPC.
    const secondAttempt = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-second-after-reclaim" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(secondAttempt, { id: "row-1", user_id: "user-1", email_type: "welcome" });
    const secondKey = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;

    expect(firstKey).toBe(secondKey);
    expect(firstKey).toBe("flowtrack-lifecycle-email/row-1");
  });

  it("a different lifecycle row (different id) always produces a different key, even for the same user/type shape", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: true, id: "msg-1" });

    const adminA = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-A", user_id: "user-1", email_type: "welcome", claim_token: "tok-1" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(adminA, { id: "row-A", user_id: "user-1", email_type: "welcome" });
    const keyA = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;
    vi.mocked(daily.sendEmail).mockClear();

    const adminB = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-B", user_id: "user-1", email_type: "welcome", claim_token: "tok-1" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
    });
    await claimAndSend(adminB, { id: "row-B", user_id: "user-1", email_type: "welcome" });
    const keyB = vi.mocked(daily.sendEmail).mock.calls[0][1]?.idempotencyKey;

    expect(keyA).not.toBe(keyB);
  });
});

describe("toEligibleUser", () => {
  it("returns null when email is missing", () => {
    expect(toEligibleUser(makeUser({ email: undefined }))).toBeNull();
  });

  it("returns null when email_confirmed_at is missing (unconfirmed)", () => {
    expect(toEligibleUser(makeUser({ email_confirmed_at: undefined }))).toBeNull();
  });

  it("extracts full_name from user_metadata when present", () => {
    const result = toEligibleUser(makeUser({ user_metadata: { full_name: "Jordan Rivera" } }));
    expect(result?.fullName).toBe("Jordan Rivera");
  });

  it("falls back to null name when user_metadata.full_name is absent/blank", () => {
    expect(toEligibleUser(makeUser({ user_metadata: {} }))?.fullName).toBeNull();
    expect(toEligibleUser(makeUser({ user_metadata: { full_name: "   " } }))?.fullName).toBeNull();
  });

  it("never trusts a non-string full_name", () => {
    expect(toEligibleUser(makeUser({ user_metadata: { full_name: 12345 } }))?.fullName).toBeNull();
  });
});

describe("ensureLifecycleRows: rollout cutoff fails closed", () => {
  it("creates nothing when cutoff is null", async () => {
    const admin = makeSupabaseAdminMock();
    const user = toEligibleUser(makeUser())!;
    const result = await ensureLifecycleRows(admin, user, null);
    expect(result.created).toBe(0);
  });

  it("creates nothing for an account created before the cutoff", async () => {
    const admin = makeSupabaseAdminMock();
    const user = toEligibleUser(makeUser({ created_at: "2026-01-01T00:00:00Z" }))!;
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const result = await ensureLifecycleRows(admin, user, cutoff);
    expect(result.created).toBe(0);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("upserts exactly three rows (welcome/feedback_48h/checkin_7d) for an eligible account", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null } });
    const user = toEligibleUser(makeUser({ created_at: "2026-09-05T00:00:00Z" }))!;
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const result = await ensureLifecycleRows(admin, user, cutoff);

    expect(admin.from).toHaveBeenCalledWith("lifecycle_emails");
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.upsert).toHaveBeenCalledTimes(1);
    const [rows, upsertOptions] = fromReturn.upsert.mock.calls[0];
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { email_type: string }) => r.email_type).sort()).toEqual(
      ["checkin_7d", "feedback_48h", "welcome"].sort()
    );
    expect(upsertOptions).toEqual({ onConflict: "user_id,email_type", ignoreDuplicates: true });
    expect(result.created).toBe(3);
  });

  it("throws (does not silently swallow) when the upsert itself errors", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: { message: "db unavailable" } } });
    const user = toEligibleUser(makeUser())!;
    await expect(ensureLifecycleRows(admin, user, new Date("2020-01-01"))).rejects.toThrow(/db unavailable/);
  });
});

describe("hasWelcomeBeenSent", () => {
  it("is true only when status is exactly 'sent'", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: { status: "sent" }, error: null } });
    expect(await hasWelcomeBeenSent(admin, "user-1")).toBe(true);
  });

  it("is false for pending/failed/processing", async () => {
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

  it("does not scope by user when no userId is given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [], error: null } });
    await findCandidateRows(admin);
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).not.toHaveBeenCalled();
  });
});

describe("claimAndSend", () => {
  const candidate = { id: "row-1", user_id: "user-1", email_type: "welcome" as const };

  beforeEach(() => {
    vi.mocked(daily.sendEmail).mockReset();
  });

  it("dryRun never claims and never sends", async () => {
    const admin = makeSupabaseAdminMock();
    const result = await claimAndSend(admin, candidate, { dryRun: true });
    expect(result).toEqual({ outcome: "skipped", reason: "not_claimed" });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(daily.sendEmail).not.toHaveBeenCalled();
  });

  it("returns skipped/not_claimed when the claim RPC returns zero rows", async () => {
    const admin = makeSupabaseAdminMock({ rpcResults: { claim_lifecycle_email: { data: [], error: null } } });
    const result = await claimAndSend(admin, candidate);
    expect(result).toEqual({ outcome: "skipped", reason: "not_claimed" });
    expect(daily.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses to send feedback_48h before welcome has been sent, and records a failed attempt", async () => {
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-2", user_id: "user-1", email_type: "feedback_48h", claim_token: "tok-1" }],
          error: null,
        },
      },
      fromResult: { data: { status: "pending" }, error: null }, // welcome not sent
    });
    const result = await claimAndSend(admin, { id: "row-2", user_id: "user-1", email_type: "feedback_48h" });
    expect(result).toEqual({ outcome: "skipped", reason: "welcome_prerequisite_not_met" });
    expect(daily.sendEmail).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_lifecycle_email",
      expect.objectContaining({ p_id: "row-2", p_claim_token: "tok-1", p_status: "failed" })
    );
  });

  it("sends the welcome email on a successful claim and completes with status=sent and the provider id", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: true, id: "resend-msg-1" });
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
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
    expect(sendOptions?.idempotencyKey).toBe(buildLifecycleEmailIdempotencyKey("row-1"));
    expect(sendOptions?.idempotencyKey).toBe("flowtrack-lifecycle-email/row-1");
    // Must never contain the claim token — only the immutable row id.
    expect(sendOptions?.idempotencyKey).not.toContain("tok-abc");
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_lifecycle_email",
      expect.objectContaining({ p_id: "row-1", p_claim_token: "tok-abc", p_status: "sent", p_provider_message_id: "resend-msg-1" })
    );
  });

  it("skips (does not send) when the live user lookup shows an unconfirmed/missing user", async () => {
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
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
        claim_lifecycle_email: {
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
      "complete_lifecycle_email",
      expect.objectContaining({ p_status: "exhausted", p_next_attempt_at: null })
    );
  });

  it("truncates an overly long error message before recording it", async () => {
    vi.mocked(daily.sendEmail).mockResolvedValue({ success: false, error: "x".repeat(1000) });
    const admin = makeSupabaseAdminMock({
      rpcResults: {
        claim_lifecycle_email: {
          data: [{ id: "row-1", user_id: "user-1", email_type: "welcome", claim_token: "tok-abc" }],
          error: null,
        },
      },
      getUserByIdResult: { data: { user: makeUser() }, error: null },
      fromResult: { data: { attempt_count: 1 }, error: null },
    });

    await claimAndSend(admin, candidate);
    const call = vi.mocked(admin.rpc).mock.calls.find((c) => c[0] === "complete_lifecycle_email");
    const lastErrorArg = (call?.[1] as { p_last_error?: string })?.p_last_error ?? "";
    expect(lastErrorArg.length).toBeLessThanOrEqual(300);
  });
});

describe("countSuppressedRows: real, scope-aware observability count", () => {
  it("reports zero when there are no suppressed rows", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 0 } });
    expect(await countSuppressedRows(admin)).toBe(0);
  });

  it("reports the exact count for one suppressed row", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 1 } });
    expect(await countSuppressedRows(admin)).toBe(1);
  });

  it("reports the exact count for multiple suppressed rows", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 7 } });
    expect(await countSuppressedRows(admin)).toBe(7);
  });

  it("filters to status = suppressed", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 2 } });
    await countSuppressedRows(admin);
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).toHaveBeenCalledWith("status", "suppressed");
  });

  it("scopes to exactly one user when userId is given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 1 } });
    await countSuppressedRows(admin, { userId: "user-1" });
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.eq).toHaveBeenCalledWith("status", "suppressed");
    expect(fromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("does not scope by user when no userId is given", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: null, error: null, count: 3 } });
    await countSuppressedRows(admin);
    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    const userScopeCalls = fromReturn.eq.mock.calls.filter((c: unknown[]) => c[0] === "user_id");
    expect(userScopeCalls).toHaveLength(0);
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

describe("suppressUpcomingLifecycleEmails: deliberate, per-user, never by email", () => {
  it("filters by exact user_id, only feedback_48h/checkin_7d, and excludes already-sent/suppressed rows", async () => {
    const admin = makeSupabaseAdminMock({ fromResult: { data: [{ id: "a" }], error: null } });
    const result = await suppressUpcomingLifecycleEmails(admin, "user-1", "user_replied_stop");

    const fromReturn = (admin.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "suppressed", suppression_reason: "user_replied_stop" })
    );
    expect(fromReturn.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(fromReturn.in).toHaveBeenCalledWith("email_type", ["feedback_48h", "checkin_7d"]);
    expect(fromReturn.not).toHaveBeenCalledWith("status", "in", "(sent,suppressed)");
    expect(result.suppressed).toBe(1);
  });
});
