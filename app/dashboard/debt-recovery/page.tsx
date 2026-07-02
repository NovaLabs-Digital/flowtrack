"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";
import HelpModal from "@/app/components/HelpModal";
import {
  computeDebtSummary,
  compareStrategies,
} from "@/lib/debt-recovery";
import {
  calculateFreedomReport,
  computeMilestones,
} from "@/lib/financial-freedom";
import type {
  Debt,
  DebtType,
  DebtStatus,
  PaymentPlan,
  DebtSummary,
  StrategyComparison,
} from "@/lib/debt-recovery";
import type { FinancialFreedomReport, Milestone } from "@/lib/financial-freedom";

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

function formatFreedomDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function DebtRecoveryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [showHelp, setShowHelp] = useState(false);

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
  const [formPaymentPlan, setFormPaymentPlan] = useState<PaymentPlan>("minimum");
  const [formCustomPayment, setFormCustomPayment] = useState("");
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
    setFormPaymentPlan("minimum");
    setFormCustomPayment("");
    setFormStatus("open");
    setFormNotes("");
    setEditingId(null);
  }

  function openEditForm(debt: Debt) {
    setFormName(debt.name);
    setFormType(debt.type);
    setFormBalance(String(debt.balance));
    setFormApr(String(debt.apr));
    setFormMinPayment(String(debt.minimum_payment));
    setFormDueDate(String(debt.due_day));
    setFormPaymentPlan(debt.payment_plan ?? "minimum");
    setFormCustomPayment(debt.custom_payment ? String(debt.custom_payment) : "");
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
    const customPayment = formCustomPayment ? Number(formCustomPayment) : null;

    if (!formName.trim() || balance <= 0 || minPayment <= 0) return;
    if (formPaymentPlan === "custom" && (!customPayment || customPayment <= 0)) return;

    setSaving(true);

    const row = {
      user_id: user.id,
      name: formName.trim(),
      type: formType,
      balance,
      apr,
      minimum_payment: minPayment,
      due_day: Math.min(Math.max(dueDate, 1), 31),
      payment_plan: formPaymentPlan,
      custom_payment: formPaymentPlan === "custom" ? customPayment : null,
      status: formStatus,
      notes: formNotes.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase
        .from("debts")
        .update(row)
        .eq("id", editingId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Update debt error:", error);
        alert(`Failed to update debt: ${error.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("debts").insert(row);
      if (error) {
        console.error("Insert debt error:", error);
        alert(`Failed to add debt: ${error.message}`);
        setSaving(false);
        return;
      }
    }

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
  const openDebts = debts.filter((d) => d.status === "open");
  const comparison: StrategyComparison | null =
    openDebts.length > 0 ? compareStrategies(debts, extraPayment) : null;

  const freedom: FinancialFreedomReport | null =
    openDebts.length > 0 ? calculateFreedomReport(debts, 0, extraPayment) : null;

  const milestones: Milestone[] = debts.length > 0 ? computeMilestones(debts) : [];

  const highestAprDebt = openDebts.length > 0
    ? openDebts.reduce((best, d) => (d.apr > best.apr ? d : best), openDebts[0])
    : null;

  const smallestBalanceDebt = openDebts.length > 0
    ? openDebts.reduce((best, d) => (d.balance < best.balance ? d : best), openDebts[0])
    : null;

  const recommendedDebt = comparison?.recommendedStrategy === "snowball"
    ? smallestBalanceDebt
    : highestAprDebt;

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
            >
              Need Help?
            </button>
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Add Debt
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-4">
          <p className="text-[11px] text-slate-500">Track. Strategize. Become debt free.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {/* ── HERO: FINANCIAL FREEDOM ── */}
        {freedom && (
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Financial Freedom</span>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-2xl font-bold text-emerald-400 mb-1">
                  {formatFreedomDate(freedom.financialFreedomDate)}
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-400">
                  <span>{freedom.yearsRemaining} yr {freedom.monthsRemaining % 12} mo remaining</span>
                  <span className="text-slate-600">|</span>
                  <span>{freedom.daysRemaining} days</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-slate-400">Progress</span>
                  <span className="text-[11px] font-semibold text-emerald-400">{freedom.progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                    style={{ width: `${freedom.progressPercent}%` }}
                  />
                </div>
                {freedom.monthsSaved > 0 && (
                  <div className="mt-2 text-[11px] text-emerald-400">
                    {freedom.monthsSaved} months and {formatCurrency(freedom.interestSaved)} saved with {freedom.currentStrategy}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SUMMARY CARDS ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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
        </div>

        {/* ── TODAY'S BEST MOVE ── */}
        {recommendedDebt && freedom && (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 mb-6">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Today&apos;s Best Move</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-semibold mb-1">{recommendedDebt.name}</div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current payment</span>
                    <span className="font-medium">{formatCurrency(recommendedDebt.minimum_payment)}/mo</span>
                  </div>
                  {freedom.recommendedExtraPayment > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Recommended payment</span>
                      <span className="font-semibold text-emerald-400">{formatCurrency(recommendedDebt.minimum_payment + freedom.recommendedExtraPayment)}/mo</span>
                    </div>
                  )}
                  {freedom.interestSaved > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Interest saved</span>
                      <span className="font-medium text-emerald-400">{formatCurrency(freedom.interestSaved)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {comparison?.recommendedStrategy === "avalanche"
                    ? `${recommendedDebt.name} has the highest APR at ${recommendedDebt.apr}%. Paying this first minimizes total interest.`
                    : `${recommendedDebt.name} has the smallest balance at ${formatCurrency(recommendedDebt.balance)}. Clearing it first builds momentum.`}
                </p>
              </div>
            </div>
          </div>
        )}

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
                      {debtTypeLabel(debt.type)}
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
                  {debt.payment_plan === "custom" && debt.custom_payment && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Paying</span>
                      <span className="font-medium text-emerald-400">{formatCurrency(debt.custom_payment)}/mo</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Due</span>
                    <span className="font-medium">{debt.due_day}{debt.due_day === 1 ? "st" : debt.due_day === 2 ? "nd" : debt.due_day === 3 ? "rd" : "th"}</span>
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

        {/* ── FREEDOM TIMELINE ── */}
        {milestones.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Freedom Timeline</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-col gap-0">
                {[
                  { title: "Today", achieved: true, progressPercent: 100, type: "today" as const },
                  ...milestones,
                ].map((m, i, arr) => (
                  <div key={m.title} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full border-2 ${
                        m.achieved
                          ? "border-emerald-400 bg-emerald-400"
                          : "border-slate-600 bg-slate-950"
                      }`} />
                      {i < arr.length - 1 && (
                        <div className={`w-px h-8 ${
                          m.achieved ? "bg-emerald-500/30" : "bg-slate-800"
                        }`} />
                      )}
                    </div>
                    <div className="pb-2">
                      <div className={`text-[11px] font-medium ${
                        m.achieved ? "text-emerald-400" : "text-slate-400"
                      }`}>
                        {m.title}
                      </div>
                      {!m.achieved && m.progressPercent > 0 && (
                        <div className="text-[10px] text-slate-600">{m.progressPercent}% there</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── DEBT COACH ── */}
        {freedom && recommendedDebt && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Debt Coach</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l-5 8h14l-5-8c1-1 2-2 2-4a4 4 0 0 0-4-4z" />
                    <path d="M12 18v4" />
                  </svg>
                </div>
                <span className="text-xs font-medium text-slate-400">Today&apos;s Recommendation</span>
              </div>
              <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
                <p>
                  Continue the <span className="font-semibold text-emerald-400">{comparison?.recommendedStrategy === "avalanche" ? "Avalanche" : "Snowball"}</span> strategy.
                </p>
                {freedom.recommendedExtraPayment > 0 && (
                  <p>
                    Pay an additional <span className="font-semibold text-emerald-400">{formatCurrency(freedom.recommendedExtraPayment)}</span> toward{" "}
                    <span className="font-semibold">{recommendedDebt.name}</span>.
                  </p>
                )}
                {freedom.interestSaved > 0 && (
                  <p className="text-slate-500">
                    This approach saves {formatCurrency(freedom.interestSaved)} in interest and {freedom.monthsSaved} months compared to the alternative strategy.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {debts.length === 0 && !loading && (
          <div className="mb-8">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-slate-700 flex items-center justify-center mx-auto mb-3">
                <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              </div>
              <p className="text-sm text-slate-400">Add your first debt to calculate your path to Financial Freedom.</p>
              <p className="text-[11px] text-slate-600 mt-1">
                FlowTrack will project your freedom date, recommend a strategy, and track your progress.
              </p>
            </div>
          </div>
        )}

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

                <div className="grid grid-cols-2 gap-3">
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
                </div>

                <div>
                  <label className="block mb-1 text-slate-400">Payment Plan</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormPaymentPlan("minimum")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                        formPaymentPlan === "minimum"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-slate-700 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      Minimum only
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormPaymentPlan("custom")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                        formPaymentPlan === "custom"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                          : "border-slate-700 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      Custom monthly
                    </button>
                  </div>
                  {formPaymentPlan === "custom" && (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formCustomPayment}
                      onChange={(e) => setFormCustomPayment(e.target.value)}
                      className="w-full mt-2 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                      placeholder="Monthly payment amount"
                      required
                    />
                  )}
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

      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        userEmail={user?.email ?? undefined}
        userId={user?.id ?? undefined}
        currentPage="Debt Recovery"
      />
    </main>
  );
}
