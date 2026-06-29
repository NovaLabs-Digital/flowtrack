import type {
  Debt,
  DebtSummary,
  StrategyType,
  StrategyResult,
  StrategyComparison,
  DebtPayoffSchedule,
} from "./types";

export function computeDebtSummary(debts: Debt[]): DebtSummary {
  const open = debts.filter((d) => d.status === "open");
  const totalDebt = open.reduce((sum, d) => sum + d.balance, 0);
  const totalMinimumPayments = open.reduce((sum, d) => sum + d.minimum_payment, 0);

  const weightedAprSum = open.reduce((sum, d) => sum + d.apr * d.balance, 0);
  const weightedAvgApr = totalDebt > 0 ? weightedAprSum / totalDebt : 0;

  const estimatedMonthlyInterest = open.reduce(
    (sum, d) => sum + (d.balance * (d.apr / 100)) / 12,
    0
  );

  return {
    totalDebt: Math.round(totalDebt * 100) / 100,
    weightedAvgApr: Math.round(weightedAvgApr * 100) / 100,
    totalMinimumPayments: Math.round(totalMinimumPayments * 100) / 100,
    estimatedMonthlyInterest: Math.round(estimatedMonthlyInterest * 100) / 100,
    debtCount: debts.length,
    openDebtCount: open.length,
  };
}

type SimDebt = {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
};

function simulatePayoff(
  debts: SimDebt[],
  extraPayment: number,
  ordering: "avalanche" | "snowball"
): DebtPayoffSchedule[] {
  if (debts.length === 0) return [];

  const active = debts.map((d) => ({
    ...d,
    remaining: d.balance,
    totalInterest: 0,
    totalPaid: 0,
    months: 0,
    paidOff: false,
  }));

  const now = new Date();
  let currentMonth = now.getMonth();
  let currentYear = now.getFullYear();
  const maxMonths = 360; // 30-year cap

  for (let month = 0; month < maxMonths; month++) {
    const unpaid = active.filter((d) => !d.paidOff);
    if (unpaid.length === 0) break;

    // Apply monthly interest
    for (const d of unpaid) {
      const monthlyRate = d.apr / 100 / 12;
      const interest = d.remaining * monthlyRate;
      d.remaining += interest;
      d.totalInterest += interest;
    }

    // Sort for extra payment priority
    const sorted = [...unpaid];
    if (ordering === "avalanche") {
      sorted.sort((a, b) => b.apr - a.apr);
    } else {
      sorted.sort((a, b) => a.remaining - b.remaining);
    }

    // Apply minimum payments
    let availableExtra = extraPayment;
    for (const d of unpaid) {
      const payment = Math.min(d.minPayment, d.remaining);
      d.remaining -= payment;
      d.totalPaid += payment;
      if (d.remaining <= 0.01) {
        d.remaining = 0;
        d.paidOff = true;
        availableExtra += d.minPayment;
      }
    }

    // Apply extra payment to priority debt
    for (const d of sorted) {
      if (d.paidOff || availableExtra <= 0) continue;
      const extra = Math.min(availableExtra, d.remaining);
      d.remaining -= extra;
      d.totalPaid += extra;
      availableExtra -= extra;
      if (d.remaining <= 0.01) {
        d.remaining = 0;
        d.paidOff = true;
        availableExtra += d.minPayment;
      }
    }

    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }

    for (const d of active) {
      if (!d.paidOff) d.months = month + 1;
      else if (d.months === 0) d.months = month + 1;
    }
  }

  return active.map((d) => {
    const payoffMonth = d.months;
    const payoffDate = new Date(now.getFullYear(), now.getMonth() + payoffMonth);
    const y = payoffDate.getFullYear();
    const m = String(payoffDate.getMonth() + 1).padStart(2, "0");

    return {
      debtId: d.id,
      debtName: d.name,
      startBalance: d.balance,
      monthsToPayoff: payoffMonth,
      totalInterestPaid: Math.round(d.totalInterest * 100) / 100,
      totalPaid: Math.round(d.totalPaid * 100) / 100,
      payoffDate: `${y}-${m}`,
    };
  });
}

export function calculateStrategy(
  debts: Debt[],
  extraPayment: number,
  strategy: StrategyType
): StrategyResult {
  const open = debts
    .filter((d) => d.status === "open" && d.balance > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      apr: d.apr,
      minPayment: d.minimum_payment,
    }));

  const ordering = strategy === "snowball" ? "snowball" : "avalanche";
  const schedules = simulatePayoff(open, extraPayment, ordering);

  const totalMonths = Math.max(...schedules.map((s) => s.monthsToPayoff), 0);
  const totalInterest = schedules.reduce((s, d) => s + d.totalInterestPaid, 0);
  const totalPaid = schedules.reduce((s, d) => s + d.totalPaid, 0);

  const debtFreeDate = schedules.length > 0
    ? schedules.reduce((latest, s) =>
        s.payoffDate > latest ? s.payoffDate : latest, schedules[0].payoffDate)
    : "";

  return {
    strategy,
    schedules,
    totalMonths,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    debtFreeDate,
  };
}

export function compareStrategies(
  debts: Debt[],
  extraPayment: number
): StrategyComparison {
  const avalanche = calculateStrategy(debts, extraPayment, "avalanche");
  const snowball = calculateStrategy(debts, extraPayment, "snowball");

  const interestSaved = Math.round(
    Math.abs(snowball.totalInterest - avalanche.totalInterest) * 100
  ) / 100;

  const monthsSaved = Math.abs(snowball.totalMonths - avalanche.totalMonths);

  const recommendedStrategy: StrategyType =
    avalanche.totalInterest <= snowball.totalInterest ? "avalanche" : "snowball";

  return {
    avalanche,
    snowball,
    recommendedStrategy,
    monthsSaved,
    interestSaved,
    recommendedExtraPayment: extraPayment,
  };
}
