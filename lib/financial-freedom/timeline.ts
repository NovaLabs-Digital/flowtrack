import type { Debt } from "../debt-recovery/types";
import type { FreedomTimeline, TimelineEntry } from "./types";

export function buildTimeline(
  debts: Debt[],
  extraPayment: number,
  ordering: "avalanche" | "snowball"
): FreedomTimeline {
  const active = debts
    .filter((d) => d.status === "open" && d.balance > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      remaining: d.balance,
      apr: d.apr,
      minPayment:
        d.payment_plan === "custom" && d.custom_payment && d.custom_payment > d.minimum_payment
          ? d.custom_payment
          : d.minimum_payment,
    }));

  if (active.length === 0) {
    return { entries: [], totalMonths: 0, totalInterest: 0, totalPrincipal: 0 };
  }

  const entries: TimelineEntry[] = [];
  const now = new Date();
  let currentMonth = now.getMonth();
  let currentYear = now.getFullYear();
  let totalInterest = 0;
  let totalPrincipal = 0;
  const maxMonths = 360;

  for (let month = 0; month < maxMonths; month++) {
    const unpaid = active.filter((d) => d.remaining > 0.01);
    if (unpaid.length === 0) break;

    let monthInterest = 0;
    let monthPrincipal = 0;

    for (const d of unpaid) {
      const interest = d.remaining * (d.apr / 100 / 12);
      d.remaining += interest;
      monthInterest += interest;
    }

    const sorted = [...unpaid];
    if (ordering === "avalanche") {
      sorted.sort((a, b) => b.apr - a.apr);
    } else {
      sorted.sort((a, b) => a.remaining - b.remaining);
    }

    let availableExtra = extraPayment;

    for (const d of unpaid) {
      const payment = Math.min(d.minPayment, d.remaining);
      d.remaining -= payment;
      monthPrincipal += payment;
      if (d.remaining <= 0.01) {
        d.remaining = 0;
        availableExtra += d.minPayment;
      }
    }

    for (const d of sorted) {
      if (d.remaining <= 0.01 || availableExtra <= 0) continue;
      const extra = Math.min(availableExtra, d.remaining);
      d.remaining -= extra;
      monthPrincipal += extra;
      availableExtra -= extra;
      if (d.remaining <= 0.01) {
        d.remaining = 0;
        availableExtra += d.minPayment;
      }
    }

    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }

    const m = String(currentMonth + 1).padStart(2, "0");
    const debtRemaining = active.reduce((s, d) => s + Math.max(d.remaining, 0), 0);

    totalInterest += monthInterest;
    totalPrincipal += monthPrincipal;

    entries.push({
      month: `${currentYear}-${m}`,
      debtRemaining: Math.round(debtRemaining * 100) / 100,
      interestPaid: Math.round(monthInterest * 100) / 100,
      principalPaid: Math.round(monthPrincipal * 100) / 100,
      debtsActive: active.filter((d) => d.remaining > 0.01).length,
    });
  }

  return {
    entries,
    totalMonths: entries.length,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPrincipal: Math.round(totalPrincipal * 100) / 100,
  };
}
