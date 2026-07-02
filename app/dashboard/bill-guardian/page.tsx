"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";
import HelpModal from "@/app/components/HelpModal";
import { scanBills } from "@/lib/bill-guardian";
import { calculateFreedomReport } from "@/lib/financial-freedom";
import type { Debt } from "@/lib/debt-recovery";
import type { BillGuardianReport, BillReminder } from "@/lib/bill-guardian";
import type { FinancialFreedomReport } from "@/lib/financial-freedom";

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case "due_today": return "Due Today";
    case "due_tomorrow": return "Due Tomorrow";
    case "upcoming": return "Coming Up";
    case "overdue": return "Needs Attention";
    case "paid": return "Completed";
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "due_today": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    case "due_tomorrow": return "text-blue-400 bg-blue-500/10 border-blue-500/30";
    case "upcoming": return "text-slate-400 bg-slate-800 border-slate-700";
    case "overdue": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    case "paid": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    default: return "text-slate-400 bg-slate-800 border-slate-700";
  }
}

export default function BillGuardianPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [showHelp, setShowHelp] = useState(false);

  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    async function loadDebts() {
      setLoading(true);
      const { data, error } = await supabase
        .from("debts")
        .select("*")
        .eq("user_id", user!.id)
        .order("due_day", { ascending: true });

      if (error) console.error("Error loading debts:", error);
      setDebts((data ?? []) as Debt[]);
      setLoading(false);
    }

    loadDebts();
  }, [authLoading, user]);

  async function handleMarkPaid(debtId: string) {
    if (!user) return;
    setMarkingPaid(debtId);

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("debts")
      .update({ last_payment_date: today })
      .eq("id", debtId)
      .eq("user_id", user.id);

    if (error) {
      alert(`Failed to mark paid: ${error.message}`);
      setMarkingPaid(null);
      return;
    }

    const { data } = await supabase
      .from("debts")
      .select("*")
      .eq("user_id", user.id)
      .order("due_day", { ascending: true });

    setDebts((data ?? []) as Debt[]);
    setMarkingPaid(null);
  }

  async function handleToggleReminder(debt: Debt) {
    if (!user) return;

    const newEnabled = !debt.reminder_enabled;
    const { error } = await supabase
      .from("debts")
      .update({
        reminder_enabled: newEnabled,
        reminder_method: newEnabled ? (debt.reminder_method ?? "email") : debt.reminder_method,
        reminder_offset: newEnabled ? (debt.reminder_offset ?? 1) : debt.reminder_offset,
      })
      .eq("id", debt.id)
      .eq("user_id", user.id);

    if (error) {
      alert(`Failed to update reminder: ${error.message}`);
      return;
    }

    const { data } = await supabase
      .from("debts")
      .select("*")
      .eq("user_id", user.id)
      .order("due_day", { ascending: true });

    setDebts((data ?? []) as Debt[]);
  }

  const openDebts = debts.filter((d) => d.status === "open");

  const freedom: FinancialFreedomReport | null =
    openDebts.length > 0 ? calculateFreedomReport(debts, 0, 0) : null;

  const report: BillGuardianReport = scanBills(debts, freedom);

  const hasAlerts = report.overdue.length > 0 || report.dueToday.length > 0;

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading...</p>
      </main>
    );
  }

  function renderBillCard(bill: BillReminder) {
    const isPaid = bill.status === "paid";
    return (
      <div
        key={bill.debtId}
        className={`rounded-xl border p-4 ${isPaid ? "border-emerald-500/20 bg-emerald-500/5" : "border-slate-800 bg-slate-900"}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-sm">{bill.debtName}</h3>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{bill.debtType.replace("_", " ")}</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${statusColor(bill.status)}`}>
            {statusLabel(bill.status)}
          </span>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Due</span>
            <span className="font-medium">{bill.dueDateFormatted}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Minimum</span>
            <span className="font-medium">{formatCurrency(bill.minimumPayment)}</span>
          </div>
          {bill.recommendedPayment > bill.minimumPayment && (
            <div className="flex justify-between">
              <span className="text-slate-400">Recommended</span>
              <span className="font-semibold text-emerald-400">{formatCurrency(bill.recommendedPayment)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-400">Balance</span>
            <span className="font-medium text-red-400">{formatCurrency(bill.balance)}</span>
          </div>
          {bill.freedomDaysGained > 0 && !isPaid && (
            <div className="flex justify-between">
              <span className="text-slate-400">Freedom days gained</span>
              <span className="font-semibold text-emerald-400">+{bill.freedomDaysGained} days</span>
            </div>
          )}
        </div>

        {!isPaid && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <button
              onClick={() => handleMarkPaid(bill.debtId)}
              disabled={markingPaid === bill.debtId}
              className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {markingPaid === bill.debtId ? "Saving..." : "I've Paid This"}
            </button>
          </div>
        )}

        {isPaid && bill.lastPaymentDate && (
          <div className="mt-2 text-[10px] text-emerald-400/60">
            Paid on {new Date(bill.lastPaymentDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
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
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">FlowTrack</span>
              <h1 className="text-base font-semibold sm:text-lg leading-tight">Bill Guardian</h1>
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
              onClick={() => router.push("/dashboard/debt-recovery")}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
            >
              Debt Recovery
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-4">
          <p className="text-[11px] text-slate-500">Protect your financial future. Never miss a payment.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {/* ── OVERDUE ALERT ── */}
        {report.overdue.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm font-semibold text-amber-300">{report.overdue.length} {report.overdue.length === 1 ? "Payment Needs" : "Payments Need"} Attention</span>
            </div>
            <p className="text-[11px] text-amber-200/60">
              Taking care of these today keeps your Financial Freedom plan moving forward.
            </p>
          </div>
        )}

        {/* ── STATUS CARDS ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Due This Month</div>
            <div className="text-lg font-semibold">{report.totalDueThisMonth}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Completed</div>
            <div className="text-lg font-semibold text-emerald-400">{report.paidThisCycle.length}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Needs Attention</div>
            <div className={`text-lg font-semibold ${report.totalOverdue > 0 ? "text-amber-400" : "text-slate-400"}`}>{report.totalOverdue}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Next Due</div>
            <div className="text-sm font-semibold">{report.nextDueDate ?? "—"}</div>
          </div>
        </div>

        {/* ── LOADING / EMPTY ── */}
        {loading ? (
          <p className="text-sm text-slate-400">Loading bills...</p>
        ) : debts.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-slate-700 flex items-center justify-center mx-auto mb-3">
              <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            </div>
            <p className="text-sm text-slate-400">You&apos;re all set up.</p>
            <p className="text-[11px] text-slate-600 mt-1">Add debts in the Debt Recovery Center and Bill Guardian will help you stay on track.</p>
          </div>
        ) : (
          <>
            {/* ── DUE TODAY ── */}
            {report.dueToday.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wide mb-3">Due Today</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {report.dueToday.map(renderBillCard)}
                </div>
              </div>
            )}

            {/* ── DUE TOMORROW ── */}
            {report.dueTomorrow.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wide mb-3">Due Tomorrow</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {report.dueTomorrow.map(renderBillCard)}
                </div>
              </div>
            )}

            {/* ── OVERDUE ── */}
            {report.overdue.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wide mb-3">Needs Attention</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {report.overdue.map(renderBillCard)}
                </div>
              </div>
            )}

            {/* ── UPCOMING ── */}
            {report.upcoming.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Coming Up</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {report.upcoming.map(renderBillCard)}
                </div>
              </div>
            )}

            {/* ── PAID THIS CYCLE ── */}
            {report.paidThisCycle.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide mb-3">Completed This Month</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {report.paidThisCycle.map(renderBillCard)}
                </div>
              </div>
            )}

            {/* ── NO ACTIVITY ── */}
            {!hasAlerts && report.upcoming.length === 0 && report.dueTomorrow.length === 0 && report.paidThisCycle.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center mb-6">
                <p className="text-sm text-slate-400">You&apos;re all caught up. No bills due in the next 7 days.</p>
              </div>
            )}
          </>
        )}

        {/* ── REMINDER PREFERENCES ── */}
        {openDebts.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Reminder Preferences</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-[11px] text-slate-500 mb-3">Toggle reminders for each debt. Delivery will be enabled in a future update.</p>
              <div className="space-y-2">
                {openDebts.map((debt) => (
                  <div key={debt.id} className="flex items-center justify-between py-1.5 border-b border-slate-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-medium">{debt.name}</span>
                      <span className="text-[10px] text-slate-500">Due {debt.due_day}{debt.due_day === 1 ? "st" : debt.due_day === 2 ? "nd" : debt.due_day === 3 ? "rd" : "th"}</span>
                    </div>
                    <button
                      onClick={() => handleToggleReminder(debt)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        debt.reminder_enabled ? "bg-emerald-500" : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          debt.reminder_enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        userEmail={user?.email ?? undefined}
        userId={user?.id ?? undefined}
        currentPage="Bill Guardian"
      />
    </main>
  );
}
