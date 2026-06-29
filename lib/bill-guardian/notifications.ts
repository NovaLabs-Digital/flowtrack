import type { BillReminder, NotificationPayload } from "./types";
import type { FinancialFreedomReport } from "../financial-freedom/types";

export function buildNotificationPayload(
  reminder: BillReminder,
  freedom: FinancialFreedomReport | null
): NotificationPayload {
  const freedomDate = freedom?.financialFreedomDate ?? "";

  return {
    debtName: reminder.debtName,
    status: reminder.status,
    dueDate: reminder.dueDateFormatted,
    minimumPayment: reminder.minimumPayment,
    recommendedPayment: reminder.recommendedPayment,
    freedomDaysGained: reminder.freedomDaysGained,
    financialFreedomDate: freedomDate,
    balance: reminder.balance,
  };
}

export function buildNotificationBatch(
  reminders: BillReminder[],
  freedom: FinancialFreedomReport | null
): NotificationPayload[] {
  return reminders.map((r) => buildNotificationPayload(r, freedom));
}
