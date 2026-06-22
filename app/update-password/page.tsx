"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!password || password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirm) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMessage(error.message);
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/dashboard"), 2000);
  }

  if (success) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
          <h1 className="text-xl font-semibold">Password updated</h1>
          <p className="mt-2 text-sm text-slate-400">
            Redirecting to your dashboard...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <h1 className="text-xl font-semibold">Set new password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your new password below.
        </p>

        {!ready && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Verifying your reset link... If this persists, request a new reset
            from the login page.
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-slate-300" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="At least 6 characters"
              minLength={6}
              disabled={!ready}
            />
          </div>

          <div>
            <label className="block mb-1 text-slate-300" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="Repeat your new password"
              minLength={6}
              disabled={!ready}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !ready}
            className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed py-2 text-sm font-medium"
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
