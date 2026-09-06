"use client";

import { useEffect, useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { getVerifiedTotpFactors, type MfaFactor } from "@/lib/mfa/factors";
import { normalizeTotpCode, isValidTotpCode } from "@/lib/mfa/totp";
import { sanitizeNextPath } from "@/lib/mfa/nextUrl";

const GENERIC_ERROR = "Incorrect or expired code. Please try again.";

export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengeForm />
    </Suspense>
  );
}

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intendedNext = sanitizeNextPath(searchParams?.get("next"));

  const [status, setStatus] = useState<"checking" | "ready" | "verifying" | "invalid">(
    "checking"
  );
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string>("");
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Forward an already-aal2 session immediately — nothing to challenge.
      const { data: aalData, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (cancelled) return;

      if (aalError || !aalData) {
        await signOutSafely();
        return;
      }

      if (aalData.currentLevel === "aal2" && aalData.nextLevel === "aal2") {
        router.replace(intendedNext);
        return;
      }

      const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();

      if (cancelled) return;

      if (factorError || !factorData) {
        await signOutSafely();
        return;
      }

      const verified = getVerifiedTotpFactors(factorData.totp as MfaFactor[]);

      if (verified.length === 0) {
        // Invalid state: this route should only be reachable with at least
        // one verified factor. Fail closed rather than show a dead-end form.
        await signOutSafely();
        return;
      }

      setFactors(verified);
      setSelectedFactorId(verified[0].id);
      setStatus("ready");
    }

    async function signOutSafely() {
      await supabase.auth.signOut();
      if (!cancelled) {
        setStatus("invalid");
        router.replace("/login");
      }
    }

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const normalized = normalizeTotpCode(code);
    if (!isValidTotpCode(normalized)) {
      setErrorMessage("Enter the 6-digit code from your authenticator app.");
      return;
    }

    if (!selectedFactorId) {
      setErrorMessage(GENERIC_ERROR);
      return;
    }

    setStatus("verifying");

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: selectedFactorId,
      code: normalized,
    });

    if (error) {
      setErrorMessage(GENERIC_ERROR);
      setCode("");
      setStatus("ready");
      return;
    }

    router.replace(intendedNext);
  }

  async function handleCancel() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (status === "checking" || status === "invalid") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <p className="text-sm text-slate-400">Checking your session...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-slate-50">Two-step verification</h1>
          <p className="text-sm text-slate-400 mt-1">
            Enter the 6-digit code from your authenticator app.
          </p>
        </header>

        {errorMessage && (
          <div className="mb-4 bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {factors.length > 1 && (
            <div>
              <label className="block mb-1 text-slate-300" htmlFor="factor">
                Authenticator
              </label>
              <select
                id="factor"
                value={selectedFactorId}
                onChange={(e) => setSelectedFactorId(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.friendly_name || "Authenticator app"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block mb-1 text-slate-300" htmlFor="code">
              6-digit code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 tracking-widest text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="000000"
            />
          </div>

          <button
            type="submit"
            disabled={status === "verifying"}
            className="w-full mt-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed py-2 text-sm font-medium"
          >
            {status === "verifying" ? "Verifying..." : "Verify"}
          </button>

          <button
            type="button"
            onClick={handleCancel}
            className="w-full mt-2 text-xs text-slate-400 hover:text-slate-300 underline underline-offset-2"
          >
            Cancel / Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
