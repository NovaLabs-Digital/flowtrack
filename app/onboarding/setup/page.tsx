"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";

export default function OnboardingSetupPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeTitle, setIncomeTitle] = useState("Main income");

  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseTitle, setExpenseTitle] = useState("Groceries");

  const [saving, setSaving] = useState(false);

  const [expenseBudget, setExpenseBudget] = useState("");

  async function handleFinishSetup() {
    if (!user) {
      router.push("/login");
      return;
    }

    const income = Number(incomeAmount);
    const expense = Number(expenseAmount);

    if (!income || income <= 0) {
      alert("Please enter your income amount.");
      return;
    }

    if (!expense || expense <= 0) {
      alert("Please enter your first expense amount.");
      return;
    }

    setSaving(true);

    const today = new Date().toISOString().slice(0, 10);

    const firstIncomeCategory = incomeTitle.trim() || "Main income";
    const firstExpenseCategory = expenseTitle.trim() || "Groceries";

    const { error: transactionError } = await supabase
      .from("transactions")
      .insert([
        {
          user_id: user.id,
          date: today,
          type: "income",
          amount: income,
          category: firstIncomeCategory,
          description: firstIncomeCategory,
        },
        {
          user_id: user.id,
          date: today,
          type: "expense",
          amount: expense,
          category: firstExpenseCategory,
          description: firstExpenseCategory,
        },
      ]);

    if (transactionError) {
      console.error("Failed to save setup transactions:", transactionError);
      setSaving(false);
      alert("Could not save your setup. Please try again.");
      return;
    }

    const { data: existingCats } = await supabase
      .from("categories")
      .select("name")
      .eq("user_id", user.id);

    const existingNames = new Set((existingCats ?? []).map((c: any) => c.name));

    const newCategories = [
      { user_id: user.id, name: firstIncomeCategory, type: "income" as const },
      { user_id: user.id, name: firstExpenseCategory, type: "expense" as const },
    ].filter((c) => !existingNames.has(c.name));

    if (newCategories.length > 0) {
      const { error: categoryError } = await supabase
        .from("categories")
        .insert(newCategories);

      if (categoryError) {
        console.error("Failed to save setup categories:", categoryError);
      }
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", user.id);

    if (profileError) {
      console.error("Failed to complete onboarding:", profileError);
      setSaving(false);
      alert("Setup saved, but onboarding could not be completed.");
      return;
    }
    const budgetValue = Number(expenseBudget);

    if (budgetValue > 0) {
    localStorage.setItem(
        "ft_category_budgets_v1",
        JSON.stringify({
        [firstExpenseCategory]: budgetValue,
        })
    );
    }

    router.push("/dashboard?welcome=1");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-blue-300">
          FlowTrack setup
        </p>

        <h1 className="mt-3 text-3xl font-bold">
          Let’s bring your dashboard to life
        </h1>

        <p className="mt-4 text-slate-300 leading-relaxed">
          Add your first income and expense so FlowTrack starts with real money
          movement.
        </p>

        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <h2 className="font-semibold text-blue-200">First income</h2>

            <div className="mt-4 space-y-4">
              <input
                value={incomeTitle}
                onChange={(e) => setIncomeTitle(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-400"
                placeholder="Main income"
              />

              <input
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-400"
                placeholder="Example: 4500"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <h2 className="font-semibold text-red-200">First expense</h2>

            <div className="mt-4 space-y-4">
              <input
                value={expenseTitle}
                onChange={(e) => setExpenseTitle(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-400"
                placeholder="Groceries"
              />

              <input
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-400"
                placeholder="Example: 85"
              />

              <input
                value={expenseBudget}
                onChange={(e) => setExpenseBudget(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-400"
                placeholder="Monthly budget (optional)"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleFinishSetup}
          disabled={saving}
          className="mt-8 w-full rounded-2xl bg-blue-500 px-5 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving setup..." : "Finish setup"}
        </button>

        <p className="mt-5 text-center text-xs text-slate-500">
          Your dashboard works better when it starts with real numbers.
        </p>
      </div>
    </main>
  );
}