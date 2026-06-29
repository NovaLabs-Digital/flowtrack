"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";
import {
  computeDebtSummary,
  compareStrategies,
} from "@/lib/debt-recovery";
import type {
  Debt,
  DebtType,
  DebtStatus,
  DebtSummary,
  StrategyComparison,
} from "@/lib/debt-recovery";

const DEBT_TYPES: { value: DebtType; label: string }[] = [
  { value: "credit_card", label: "Credit Card" },
  { value: "mortgage", label: "Mortgage" },
  { value: "auto_loan", label: "Auto Loan" },
  { value: "student_loan", label: "Student Loan" },
  { value: "personal_loan", label: "Personal Loan" },
  { value: "line_of_credit", label: "Line of Credit" },
  { value: "medical_debt", label: "Medical Debt" },
  { value: "other", label: "Other" },
];

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function debtTypeLabel(t: DebtType): string {
  return DEBT_TYPES.find((d) => d.value === t)?.label ?? t;
}

export default function DebtRecoveryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [extraPayment, setExtraPayment] = useState(0);

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<DebtType>("credit_card");
  const [formBalance, setFormBalance] = useState("");
  const [formApr, setFormApr] = useState("");
  const [formMinPayment, setFormMinPayment] = useState("");
  const [formDueDate, setFormDueDate] = useState("1");
  const [formSuggested, setFormSuggested] = useState("");
  const [formStatus, setFormStatus] = useState<DebtStatus>("open");
  const [formNotes, setFormNotes] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;

    async function loadDebts() {
      setLoading(true);
      const { data, error } = await supabase
        .from("debts")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error loading debts:", error);
      }
      setDebts((data ?? []) as Debt[]);
      setLoading(false);
    }

    loadDebts();
  }, [authLoading, user]);

  function resetForm() {
    setFormName("");
    setFormType("credit_card");
    setFormBalance("");
    setFormApr("");
    setFormMinPayment("");
    setFormDueDate("1");
    setFormSuggested("");
    setFormStatus("open");
    setFormNotes("");
    setEditingId(null);
  }

  function openEditForm(debt: Debt) {
    setFormName(debt.name);
    setFormType(debt.debt_type);
    setFormBalance(String(debt.balance));
    setFormApr(String(debt.apr));
    setFormMinPayment(String(debt.minimum_payment));
    setFormDueDate(String(debt.due_date));
    setFormSuggested(debt.suggested_payment ? String(debt.suggested_payment) : "");
    setFormStatus(debt.status);
    setFormNotes(debt.notes ?? "");
    setEditingId(debt.id);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;

    const balance = Number(formBalance);
    const apr = Number(formApr);
    const minPayment = Number(formMinPayment);
    const dueDate = Number(formDueDate);
    const suggested = formSuggested ? Number(formSuggested) : null;

    if (!formName.trim() || balance <= 0 || minPayment <= 0) return;

    setSaving(true);

    const row = {
      user_id: user.id,
      name: formName.trim(),
      debt_type: formType,
      balance,
      apr,
      minimum_payment: minPayment,
      due_date: Math.min(Math.max(dueDate, 1), 31),
      suggested_payment: suggested,
      status: formStatus,
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase
        .from("debts")
        .update(row)
        .eq("id", editingId)
        .eq("user_id", user.id);

      if (error) console.error("Update debt error:", error);
    } else {
      const { error } = await supabase.from("debts").insert(row);
      if (error) console.error("Insert debt error:", error);
    }

    // Reload
    const { data } = await supabase
      .from("debts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    setDebts((data ?? []) as Debt[]);
    resetForm();
    setShowForm(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!user) return;
    if (!window.confirm("Delete this debt? This cannot be undone.")) return;

    await supabase.from("debts").delete().eq("id", id).eq("user_id", user.id);

    const { data } = await supabase
      .from("debts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    setDebts((data ?? []) as Debt[]);
  }

  const summary: DebtSummary = computeDebtSummary(debts);
  const comparison: StrategyComparison | null =
    debts.filter((d) => d.status === "open").length > 0
      ? compareStrategies(debts, extraPayment)
      : null;

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── WORKSPACE HEADER ── */}
      <header className="border-b border-slate-800/60 bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              ← Dashboard
            </button>
            <div className="h-5 w-px bg-slate-800" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">FlowTrack</span>
              </div>
              <h1 className="text-base font-semibold sm:text-lg leading-tight">Debt Recovery Center</h1>
            </div>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Add Debt
          </button>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-4">
          <p className="text-[11px] text-slate-500">Track. Strategize. Become debt free.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {/* ── SUMMARY CARDS ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Total Debt</div>
            <div className="text-lg font-semibold text-red-400">{formatCurrency(summary.totalDebt)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Weighted Avg APR</div>
            <div className="text-lg font-semibold">{summary.weightedAvgApr.toFixed(2)}%</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Total Minimums</div>
            <div className="text-lg font-semibold">{formatCurrency(summary.totalMinimumPayments)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Monthly Interest</div>
            <div className="text-lg font-semibold text-amber-400">{formatCurrency(summary.estimatedMonthlyInterest)}</div>
          </div>
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Financial Freedom Date</div>
            <div className="text-lg font-semibold text-slate-600">
              {comparison ? comparison.avalanche.debtFreeDate : "—"}
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">Full projections coming soon</div>
          </div>
        </div>

        {/* ── YOUR DEBTS ── */}
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Your Debts</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Loading debts...</p>
        ) : debts.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
            <p className="text-slate-400 text-sm">No debts added yet.</p>
            <p className="text-slate-500 text-xs mt-1">Add your first debt to start building a payoff strategy.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {debts.map((debt) => (
              <div
                key={debt.id}
                className={`rounded-xl border p-4 ${
                  debt.status === "paid_off"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-slate-800 bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm">{debt.name}</h3>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {debtTypeLabel(debt.debt_type)}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      debt.status === "paid_off"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {debt.status === "paid_off" ? "Paid Off" : "Open"}
                  </span>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Balance</span>
                    <span className="font-semibold text-red-400">{formatCurrency(debt.balance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">APR</span>
                    <span className="font-medium">{debt.apr}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Minimum</span>
                    <span className="font-medium">{formatCurrency(debt.minimum_payment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Due</span>
                    <span className="font-medium">{debt.due_date}{debt.due_date === 1 ? "st" : debt.due_date === 2 ? "nd" : debt.due_date === 3 ? "rd" : "th"}</span>
                  </div>
                  {debt.notes && (
                    <p className="text-slate-500 pt-1 border-t border-slate-800">{debt.notes}</p>
                  )}
                </div>

                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                  <button
                    onClick={() => openEditForm(debt)}
                    className="flex-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(debt.id)}
                    className="rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── STRATEGY COMPARISON ── */}
        {comparison && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Payoff Strategy</h2>

            <div className="mb-4 flex items-center gap-3">
              <label className="text-sm text-slate-400">Extra monthly payment:</label>
              <input
                type="number"
                min="0"
                step="25"
                value={extraPayment || ""}
                onChange={(e) => setExtraPayment(Number(e.target.value) || 0)}
                className="w-28 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm"
                placeholder="$0"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              {/* Avalanche */}
              <div className={`rounded-xl border p-4 ${comparison.recommendedStrategy === "avalanche" ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">Avalanche</h3>
                  {comparison.recommendedStrategy === "avalanche" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">Recommended</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mb-3">Pay highest APR first. Saves the most on interest.</p>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Months to debt-free</span>
                    <span className="font-semibold">{comparison.avalanche.totalMonths}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total interest</span>
                    <span className="font-semibold text-red-400">{formatCurrency(comparison.avalanche.totalInterest)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total paid</span>
                    <span className="font-medium">{formatCurrency(comparison.avalanche.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Debt-free date</span>
                    <span className="font-medium">{comparison.avalanche.debtFreeDate}</span>
                  </div>
                </div>
              </div>

              {/* Snowball */}
              <div className={`rounded-xl border p-4 ${comparison.recommendedStrategy === "snowball" ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">Snowball</h3>
                  {comparison.recommendedStrategy === "snowball" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">Recommended</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mb-3">Pay smallest balance first. Builds momentum faster.</p>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Months to debt-free</span>
                    <span className="font-semibold">{comparison.snowball.totalMonths}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total interest</span>
                    <span className="font-semibold text-red-400">{formatCurrency(comparison.snowball.totalInterest)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total paid</span>
                    <span className="font-medium">{formatCurrency(comparison.snowball.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Debt-free date</span>
                    <span className="font-medium">{comparison.snowball.debtFreeDate}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Savings callout */}
            {comparison.interestSaved > 0 && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <span className="font-semibold text-emerald-400">{comparison.recommendedStrategy === "avalanche" ? "Avalanche" : "Snowball"}</span> saves you{" "}
                <span className="font-semibold text-emerald-400">{formatCurrency(comparison.interestSaved)}</span> in interest
                {comparison.monthsSaved > 0 && (
                  <> and <span className="font-semibold text-emerald-400">{comparison.monthsSaved} months</span></>
                )}.
              </div>
            )}
          </div>
        )}

        {/* ── AI DEBT COACH (future) ── */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">AI Debt Coach</h2>
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-slate-700 flex items-center justify-center mx-auto mb-3">
              <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l-5 8h14l-5-8c1-1 2-2 2-4a4 4 0 0 0-4-4z" />
                <path d="M12 18v4" />
              </svg>
            </div>
            <p className="text-sm text-slate-400">Personalized debt payoff coaching is coming soon.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              The AI Coach will analyze your debts, income, and spending to recommend the fastest path to financial freedom.
            </p>
          </div>
        </div>

        {/* ── ADD/EDIT FORM MODAL ── */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{editingId ? "Edit Debt" : "Add Debt"}</h2>
                <button
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="text-slate-400 hover:text-slate-200 text-sm"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 text-sm">
                <div>
                  <label className="block mb-1 text-slate-400">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                    placeholder="e.g. Visa Platinum"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-400">Type</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as DebtType)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                    >
                      {DEBT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-400">Status</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as DebtStatus)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                    >
                      <option value="open">Open</option>
                      <option value="paid_off">Paid Off</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-400">Current Balance</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formBalance}
                      onChange={(e) => setFormBalance(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="7245.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-400">APR %</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formApr}
                      onChange={(e) => setFormApr(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="27.99"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-400">Minimum Payment</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formMinPayment}
                      onChange={(e) => setFormMinPayment(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="145"
                      required
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-400">Due Date</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="15"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-400">Suggested (opt)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formSuggested}
                      onChange={(e) => setFormSuggested(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="200"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-slate-400">Notes (optional)</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm resize-none"
                    rows={2}
                    placeholder="Any notes about this debt..."
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); resetForm(); }}
                    className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : editingId ? "Update Debt" : "Add Debt"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
