// app/auth/confirm/page.tsx
//
// Landing page for Supabase's email confirmation link. This project's
// Supabase client (lib/supabaseclient.ts) is a plain browser client with no
// server-side session/cookie architecture (no @supabase/ssr, no
// middleware.ts), so — matching every other auth surface in this app
// (login, mfa-challenge, update-password) — this is a client page that
// calls supabase.auth directly, not a route handler.
//
// This route is reached only once Alberto configures the Supabase Dashboard
// "Confirm signup" email template to link here. Because the signup/resend
// calls in app/signup/page.tsx already pass the complete callback URL
// (`${window.location.origin}/auth/confirm`) via `emailRedirectTo`, the
// template must reuse that value through Supabase's `{{ .RedirectTo }}`
// variable rather than `{{ .SiteURL }}` (which is a different,
// project-level value and would not necessarily point here), and must NOT
// append "/auth/confirm" again — `{{ .RedirectTo }}` already contains it.
// The exact template link Alberto must configure is:
//
//   {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
//
// The complete production callback URL (https://www.appflowtrack.com/auth/confirm)
// must also be present in the Supabase project's Redirect URLs allowlist,
// or `emailRedirectTo` will be rejected. Until this Dashboard configuration
// is done, and with Confirm Email OFF, nothing links to this page in
// production.
"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";

const GENERIC_INVALID_MESSAGE =
  "This confirmation link is invalid or has expired.";

// Only the two EmailOtpType values relevant to account confirmation are
// accepted here — magiclink/recovery/invite/email_change are different
// flows this page isn't built to handle, and this page must not become a
// generic OTP-verification endpoint for arbitrary query-param input.
type ConfirmOtpType = "signup" | "email";
const ALLOWED_TYPES = new Set<string>(["signup", "email"]);

function isAllowedType(value: string | null): value is ConfirmOtpType {
  return value !== null && ALLOWED_TYPES.has(value);
}

// Best-effort only: never awaited by the caller, and its outcome never
// affects navigation or this page's state. A scheduled cron
// (/api/cron/signup-emails) independently discovers and retries any
// confirmed user whose welcome email is still pending, so a failed or
// interrupted (e.g. browser closed) attempt here is never the only chance
// at delivery — this request, cron, or both together may end up sending
// it; that's fine, since the atomic claim in the shared service makes
// duplicate sends safe either way.
//
// keepalive: true asks the browser to let this request outlive the page
// that started it (e.g. the router.replace navigation right after this
// call), instead of the navigation risking cancellation of an in-flight
// fetch. It improves the odds this best-effort attempt actually reaches
// the server — it does not guarantee delivery: the request can still fail,
// time out, or (per the browser's keepalive rules) be dropped if it were
// ever given a body over ~64KB, which this one never has since it sends
// none.
function triggerWelcomeEmailBestEffort(accessToken: string) {
  fetch("/api/lifecycle-emails/welcome", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: true,
  }).catch(() => {
    // Intentionally ignored — see comment above.
  });
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailForm />
    </Suspense>
  );
}

function ConfirmEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"verifying" | "invalid">("verifying");

  useEffect(() => {
    let cancelled = false;

    // Covers three of the required cases at once: a link opened while
    // already authenticated, a duplicate/reused (already-consumed) link
    // clicked again by a still-signed-in user, and a page refresh after a
    // token_hash has already been consumed by an earlier successful run —
    // in all three, the user already has a valid session and should simply
    // continue, not see an error.
    async function continueWithExistingSessionOrShowInvalid() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data?.session) {
        router.replace("/dashboard");
        return;
      }

      setStatus("invalid");
    }

    async function run() {
      const tokenHash = searchParams?.get("token_hash");
      const type = searchParams?.get("type");

      // Scrub the confirmation secret from the visible URL immediately —
      // before any asynchronous work — so token_hash never lingers in the
      // address bar, browser history, or a later back/forward navigation.
      // A single-use token is safe to have already read into the local
      // consts above; nothing below needs it to still be in the URL.
      if (window.location.search) {
        window.history.replaceState(null, "", window.location.pathname);
      }

      // Missing/malformed callback parameters.
      if (!tokenHash || !isAllowedType(type)) {
        await continueWithExistingSessionOrShowInvalid();
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

      if (cancelled) return;

      // Expired/invalid/already-used token, or any other Supabase error —
      // never surface the underlying error text, which could contain
      // internal detail.
      if (error || !data.session) {
        await continueWithExistingSessionOrShowInvalid();
        return;
      }

      // Deliberately not awaited — see triggerWelcomeEmailBestEffort's
      // comment. Confirmation/dashboard access must never wait on, or be
      // blocked by, email delivery.
      triggerWelcomeEmailBestEffort(data.session.access_token);

      router.replace("/dashboard");
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "verifying") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <p className="text-sm text-slate-400">Confirming your email...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg text-center">
        <h1 className="text-xl font-semibold text-slate-50">
          Link invalid or expired
        </h1>
        <p className="text-sm text-slate-400 mt-2">
          {GENERIC_INVALID_MESSAGE} You can request a new one from the sign up
          page, or log in if you already confirmed your account.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <a
            href="/signup"
            className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline text-sm"
          >
            Return to sign up
          </a>
          <a
            href="/login"
            className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline text-sm"
          >
            Return to login
          </a>
        </div>
      </div>
    </main>
  );
}
