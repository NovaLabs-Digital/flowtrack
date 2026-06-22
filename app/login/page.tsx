// app/login/page.tsx
"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugStatus, setDebugStatus] = useState<string>("Idle");
  const [resetMessage, setResetMessage] = useState<string | null>(null);

 

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setResetMessage(null);
    setDebugStatus("Starting login…");

    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      setDebugStatus("Missing email or password.");
      return;
    }

    setSubmitting(true);

    try {
      const canSignIn =
        (supabase as any)?.auth &&
        typeof (supabase as any).auth.signInWithPassword === "function";

      if (!canSignIn) {
        setDebugStatus("Supabase auth client is not available.");
        setErrorMessage(
          "Supabase auth client is not available. Check supabaseclient.ts and env vars."
        );
        return;
      }

      setDebugStatus("Calling supabase.auth.signInWithPassword…");

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("Login error:", error);
        setErrorMessage(error.message || "Login failed.");
        setDebugStatus(`Login error: ${error.message || "Unknown error"}`);
        return;
      }

      setDebugStatus("Login success. Redirecting to dashboard…");

      // ✅ Hard redirect so it behaves like when you type /dashboard manually
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 150);
    } catch (err: any) {
      console.error("Unexpected login error:", err);
      setErrorMessage("Unexpected error during login.");
      setDebugStatus(
        `Unexpected error: ${err?.message ?? String(err ?? "Unknown")}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    setErrorMessage(null);
    setResetMessage(null);

    if (!email) {
      setErrorMessage("Please enter your email above first.");
      return;
    }

    try {
      setDebugStatus("Sending password reset email…");

      const redirectTo = `${window.location.origin}/update-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        console.error("Reset password error:", error);
        setErrorMessage(error.message || "Could not send reset email.");
        setDebugStatus(`Reset error: ${error.message || "Unknown error"}`);
        return;
      }

      setResetMessage("Check your email for a password reset link.");
      setDebugStatus("Password reset email sent.");
    } catch (err: any) {
      console.error("Unexpected reset error:", err);
      setErrorMessage("Unexpected error while sending reset email.");
      setDebugStatus(
        `Reset unexpected error: ${err?.message ?? String(err ?? "Unknown")}`
      );
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-slate-50">
            Welcome back
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Log in to your FlowTrack dashboard.
          </p>
        </header>

        {/* Spinner while submitting */}
        {submitting && (
          <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="inline-block h-3 w-3 rounded-full border border-slate-400 border-t-transparent animate-spin" />
            <span>Signing you in…</span>
          </div>
        )}

        {/* Error / reset messages */}
        {errorMessage && (
          <div className="mb-4 bg-red-500/10 border border-red-500 text-red-200 text-xs rounded-lg px-3 py-2">
            {errorMessage}
          </div>
        )}

        {resetMessage && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500 text-emerald-200 text-xs rounded-lg px-3 py-2">
            {resetMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block mb-1 text-slate-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed py-2 text-sm font-medium"
          >
            {submitting ? "Signing in..." : "Log in"}
          </button>

          <button
            type="button"
            onClick={handleResetPassword}
            className="w-full mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            Forgot your password?
          </button>
        </form>

        <p className="mt-4 text-[11px] text-slate-400">
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline"
          >
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}


// redeploy trigger
