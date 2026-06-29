export type ReminderStatus =
  | "due_today"
  | "due_tomorrow"
  | "upcoming"
  | "overdue"
  | "paid";

export type BillReminder = {
  debtId: string;
  debtName: string;
  debtType: string;
  status: ReminderStatus;
  dueDay: number;
  dueDateFormatted: string;
  minimumPayment: number;
  recommendedPayment: number;
  balance: number;
  apr: number;
  freedomDaysGained: number;
  lastPaymentDate: string | null;
  reminderEnabled: boolean;
  reminderMethod: string | null;
  reminderOffset: number | null;
};

export type BillGuardianReport = {
  dueToday: BillReminder[];
  dueTomorrow: BillReminder[];
  upcoming: BillReminder[];
  overdue: BillReminder[];
  paidThisCycle: BillReminder[];
  totalDueThisMonth: number;
  totalOverdue: number;
  nextDueDate: string | null;
  generatedAt: string;
};

export type NotificationPayload = {
  debtName: string;
  status: ReminderStatus;
  dueDate: string;
  minimumPayment: number;
  recommendedPayment: number;
  freedomDaysGained: number;
  financialFreedomDate: string;
  balance: number;
};
