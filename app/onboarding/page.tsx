"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    if (!user) {
      router.push("/login");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", user.id);

    if (error) {
      console.error("Failed to complete onboarding:", error);
      setLoading(false);
      return;
    }

    router.push("/onboarding/setup");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-300">
            FlowTrack
          </p>

          <h1 className="mt-3 text-3xl font-bold">
            Welcome to your money control center
          </h1>

          <p className="mt-4 text-slate-300 leading-relaxed">
            FlowTrack helps you see where your money is going, measure your
            income and expenses, and stay disciplined with your financial habits.
          </p>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="font-semibold text-blue-200">1. Add your income</h2>
            <p className="mt-2 text-sm text-slate-400">
              Start by entering your income sources so FlowTrack can measure what
              is coming in.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="font-semibold text-blue-200">2. Track expenses</h2>
            <p className="mt-2 text-sm text-slate-400">
              Add expenses by category and begin seeing where your money is
              really going.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="font-semibold text-blue-200">3. Build discipline</h2>
            <p className="mt-2 text-sm text-slate-400">
              Check FlowTrack daily to stay in control and build better financial
              habits.
            </p>
          </div>
        </div>

        <button
          onClick={handleContinue}
          disabled={loading}
          className="mt-8 w-full rounded-2xl bg-blue-500 px-5 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Saving..." : "Continue to Setup"}
        </button>

        <p className="mt-5 text-center text-xs text-slate-500">
          See it. Measure it. Control it.
        </p>
      </div>
    </main>
  );
}