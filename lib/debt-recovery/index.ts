export type {
  Debt,
  DebtType,
  DebtStatus,
  PaymentPlan,
  DebtSummary,
  StrategyType,
  StrategyResult,
  StrategyComparison,
  ReminderMethod,
  ReminderOffset,
  PaymentSourceType,
} from "./types";

export {
  computeDebtSummary,
  calculateStrategy,
  compareStrategies,
} from "./calculations";

export {
  normalizePaymentSourceType,
  normalizePaymentSourceName,
  normalizePaymentSourceLast4,
  validatePaymentSourcePair,
  formatPaymentSourceDisplay,
} from "./payment-source";
export type { NormalizedField } from "./payment-source";
