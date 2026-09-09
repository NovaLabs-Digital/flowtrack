// Smallest protected server endpoint /auth/confirm can call to request an
// immediate best-effort welcome email. This is NOT the only path a welcome
// can be sent through — /api/cron/signup-emails independently discovers
// and retries any confirmed user whose welcome row is still pending
// (browser closed, this request failed, etc.). Both paths share the exact
// same claim/send logic in lib/lifecycle-emails/service.ts.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ensureLifecycleRows,
  findCandidateRows,
  claimAndSend,
  toEligibleUser,
} from "@/lib/lifecycle-emails/service";
import { parseSignupEmailsStartAt, SIGNUP_EMAILS_START_AT_ENV } from "@/lib/lifecycle-emails/eligibility";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Every response — success, ineligible, already sent, suppressed, failed,
// even a malformed request — returns this exact generic body. Only an
// actually-missing/invalid bearer token gets a distinct 401; nothing about
// lifecycle-email state is ever disclosed to the caller.
const GENERIC_OK = NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Server-verified identity only — the request body/query is never
  // consulted for a recipient or user id.
  const { data, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const eligibleUser = toEligibleUser(data.user);
    if (!eligibleUser) {
      // Not confirmed (or no email) — same generic response, no detail.
      return GENERIC_OK;
    }

    const cutoff = parseSignupEmailsStartAt(process.env[SIGNUP_EMAILS_START_AT_ENV]);
    await ensureLifecycleRows(supabaseAdmin, eligibleUser, cutoff);

    const candidates = await findCandidateRows(supabaseAdmin, { userId: eligibleUser.id });
    const welcomeCandidate = candidates.find((c) => c.email_type === "welcome");

    if (welcomeCandidate) {
      // Best-effort: any outcome (sent/skipped/failed) is swallowed into
      // the same generic response. The cron route is what guarantees
      // eventual delivery if this attempt doesn't succeed.
      await claimAndSend(supabaseAdmin, welcomeCandidate);
    }
  } catch {
    // Never let a lifecycle-email failure surface as anything other than
    // the same generic response — and never let it block confirmation.
  }

  return GENERIC_OK;
}
