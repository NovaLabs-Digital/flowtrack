// app/dashboard/page.tsx
"use client";

import { useEffect, useState, FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";
import { PRICING } from "@/lib/pricing";


type TransactionType = "income" | "expense";

type Transaction = {
  id: string;
  user_id: string;
  created_at: string | null;
  date: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string | null;
};

type Category = {
  id?: string;          // from Supabase
  user_id?: string;     // from Supabase
  sort_index?: number;  // from Supabase
  name: string;
  type: TransactionType;
};

// ---- DEFAULTS & STORAGE KEYS ----

const DEFAULT_CATEGORIES: Category[] = [
  { name: "Rent / Mortgage", type: "expense" },
  { name: "Side Income", type: "income" },
  { name: "Groceries", type: "expense" },
  { name: "Dining Out", type: "expense" },
  { name: "Transportation", type: "expense" },
  { name: "Utilities", type: "expense" },
  { name: "Debt Payments", type: "expense" },
  { name: "Subscriptions", type: "expense" },
  { name: "Salary / Wages", type: "income" },
  
];

const DEFAULT_CATEGORY_BUDGETS: Record<string, number> = {};
const CATEGORIES_STORAGE_KEY = "ft_categories_v1";
const BUDGETS_STORAGE_KEY = "ft_category_budgets_v1";

// ---- HELPERS ----
function summarize(transactions: Transaction[]) {
  const income = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const expenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const net = income - expenses;
  return { income, expenses, net };
}

// Global override to detect ISO dates anywhere and format automatically
function displayDate(v: string) {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v); // convert YYYY-MM-DD → MM/DD/YYYY
  return v; // otherwise print as-is
}

function toLocalISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatShortDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function getActiveRangeLabel(
  usingCustomRange: boolean,
  periodStart: string,
  periodEnd: string,
  windowDays: number
) {
  if (usingCustomRange) {
    return `Custom: ${formatShortDate(periodStart)} → ${formatShortDate(periodEnd)}`;
  }
  return `Last ${windowDays} days`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1); // LOCAL date (no UTC shift)
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSpendingRatio(income: number, expenses: number) {
  if (income <= 0) return 1;
  const ratio = expenses / income;
  return Math.min(Math.max(ratio, 0), 2);
}

type ReportRangeMode = "thisMonth" | "lastNDays" | "current" | "custom" | "lastMonth";


function BudgetStatusIcon({ status }: { status: "ok" | "near" | "over" | "none" }) {
  if (status === "none") return null;

  const common = "inline-block align-[-2px] mr-2";
  const size = 14;

        if (status === "ok") {
          return (
            <svg className={common + " text-emerald-600"} width={size} height={size} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M7 12l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          );
        }

        if (status === "near") {
          return (
            <svg className={common + " text-amber-600"} width={size} height={size} viewBox="0 0 24 24" fill="none">
              <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="2" />
              <path d="M12 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="17" r="1" fill="currentColor" />
            </svg>
          );
        }

        // over
        return (
          <svg className={common + " text-rose-600"} width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17" r="1" fill="currentColor" />
          </svg>
        );
      }

    function isProUser(plan?: string | null) {
      return plan === "pro";
      }

    function requirePro(isPro: boolean, onBlocked: () => void) {
      if (isPro) return true;
      onBlocked();
      return false;
    }

      function UpgradeModal({
            open,
            onClose,
          }: {
            open: boolean;
            onClose: () => void;
          }) {
            if (!open) return null;

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                <div className="w-full max-w-md rounded-xl bg-slate-950 border border-slate-800 p-6">
                  <h2 className="text-lg font-semibold mb-2"> Pro Pro</h2>
                  <p className="text-sm text-slate-400 mb-4">
                    Get custom date ranges, advanced PDF reports, and up to 120 days of history.
                  </p>

                  <div className="flex justify-end gap-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      Maybe later
                    </button>

                    <button
                      onClick={() => {
                        onClose();
                        // Stripe will go here in Step 2
                        alert("Stripe checkout coming next 🚀");
                      }}
                      className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-black hover:bg-emerald-500"
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                </div>
              </div>
            );
          }


export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  
  const categoryListRef = useRef<HTMLUListElement | null>(null);
  const incomeScrollRef = useRef<HTMLDivElement | null>(null);
  const expenseScrollRef = useRef<HTMLDivElement | null>(null);

  const [profile, setProfile] = useState<{
  plan: string;
  category_order: string[];
  stripe_subscription_status?: string | null;
  pro_grace_until?: string | null;
  } | null>(null);


  const [profileLoading, setProfileLoading] = useState(true);
  
  const plan = (profile?.plan ?? "free").toString().trim().toLowerCase();
  
  const subStatus: string | null = profile?.stripe_subscription_status ?? null;
  const graceUntilRaw: string | null = profile?.pro_grace_until ?? null;

  const graceUntil = graceUntilRaw ? new Date(graceUntilRaw) : null;
  const now = new Date();

  const inGrace = graceUntil ? now < graceUntil : false;
  const paidOk = subStatus === "active" || subStatus === "trialing";

  // ✅ if user is "pro" but we have no billing fields yet, treat as pro
  const legacyPro = subStatus === null && graceUntilRaw === null;

  const isPro = plan === "pro" && (paidOk || inGrace || legacyPro);

 
  
    // ISO date string YYYY-MM-DD for Supabase filter

  // ---- TIME WINDOW (FREE vs PRO) ----
  const DAY_OPTIONS = isPro ? [7, 14, 30, 60, 90, 120] : [7, 14, 30];
  const [windowDays, setWindowDays] = useState<number>(isPro ? 90 : 30);

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);

    function openUpgrade(reason?: string) {
    setUpgradeReason(reason ?? null);
    setShowUpgrade(true);
    }

    function closeUpgrade() {
      setShowUpgrade(false);
      setUpgradeReason(null);
    }

    <div className=""></div>

      async function loadProfile(userId: string) {
        setProfileLoading(true);

        const { data, error } = await supabase
          .from("profiles")
          .select("plan, category_order, pro_grace_until, stripe_subscription_status")
          .eq("id", userId)
          .maybeSingle();

        if (error) {
          console.error("Error loading profile:", error);
          setProfile({ plan: "free", category_order: [] });
          setProfileLoading(false);
          return;
        }

        if (!data) {
          // create missing profile
          const { error: insertErr } = await supabase
            .from("profiles")
            .insert({ id: userId, plan: "free", category_order: [] });

          if (insertErr) {
            console.error("Error creating profile:", insertErr);
          }

          setProfile({ plan: "free", category_order: [] });
          setProfileLoading(false);
          return;
        }

        setProfile({
          plan: (data.plan ?? "free").toString().toLowerCase(),
          category_order: data.category_order ?? [],
        });

        setProfileLoading(false);
      }

    
      async function handleUpgrade() {
        
        if (!userId || !userEmail) {
          alert("Missing user session. Please log out and log in again.");
          return;
        }

        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, email: userEmail }),
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch (e) {
          
        }

          if (!res.ok) {
          alert(data?.error ?? `Checkout failed (status ${res.status})`);
          return;
        }

        if (data?.url) {
          
          window.location.href = data.url;
        } else {
          alert("Checkout failed: missing session url");
        }
      }


          
    function handlePrintReport() {
      if (!isPro) {
        openUpgrade("Print / PDF reports are Pro.");
        return;
      }
      window.print();
    }


  // ---- USER & DATA STATE ----
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightedTxId, setHighlightedTxId] = useState<string | null>(null);

  // ---- CATEGORY STATE (LEFT BAR) ----
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] =
    useState<TransactionType>("expense");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // ---- INLINE ENTRY FORM (LEFT BAR) ----
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // split categories
  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  // ---- EDIT TRANSACTION (CENTER) ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<string>("");
  const [editingCategory, setEditingCategory] = useState<string>("");
  const [editingDate, setEditingDate] = useState("");
  const [editingDescription, setEditingDescription] = useState<string>("");
  const [editingSaving, setEditingSaving] = useState(false);

  // ---- QUICK ADD BAR (CENTER TOP) ----
  const [quickCategory, setQuickCategory] = useState<string>("");
  const [quickAmount, setQuickAmount] = useState("");
  const [quickAddStatus, setQuickAddStatus] =
    useState<"idle" | "added" | "error">("idle");

  const [quickDate, setQuickDate] = useState("");
  const [quickDescription, setQuickDescription] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
    // ---- PRINT / PDF ----
  const [printDialogOpen, setPrintDialogOpen] = useState(false);


  // ---- SIMPLE BUDGETS (RIGHT SIDEBAR, LOCAL ONLY FOR NOW) ----
  const [categoryBudgets, setCategoryBudgets] =
    useState<Record<string, number>>(DEFAULT_CATEGORY_BUDGETS);


// ---- REPORT / PDF RANGE ----

type ReportRangeMode = "thisMonth" | "lastMonth" | "lastNDays" | "current" | "custom";

// what kind of period we are showing in the report / PDF
const [reportRangeMode, setReportRangeMode] = useState<ReportRangeMode>("lastNDays");

// for the custom date range (stored as date strings "YYYY-MM-DD")
const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");

const [customStart, setCustomStart] = useState<string>("");
const [customEnd, setCustomEnd] = useState<string>("");

const [appliedStart, setAppliedStart] = useState<string | null>(null);
const [appliedEnd, setAppliedEnd] = useState<string | null>(null);



// are we using the custom range right now?
// base rolling window (same as dashboard view)
const today = new Date();
const todayStr = toLocalISODate(today);

const windowStartDate = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - (windowDays - 1)
);
const windowStartStr = toLocalISODate(windowStartDate);

// unified period start/end used by inputs and reports

// unified period start/end used by inputs and reports
// unified period start/end used by inputs and reports
const usingCustomRange =
  rangeMode === "custom" && !!appliedStart && !!appliedEnd;

const periodStart = usingCustomRange ? (appliedStart as string) : windowStartStr;
const periodEnd = usingCustomRange ? (appliedEnd as string) : todayStr;


// one label used everywhere (UI + PDF header)
const activeRangeLabel = getActiveRangeLabel(
  usingCustomRange,
  periodStart,
  periodEnd,
  windowDays
);

// keep existing name if other code uses periodLabel
const periodLabel = activeRangeLabel;


const [draggingName, setDraggingName] = useState<string | null>(null);

function moveCategoryByDrag(dragName: string, dropName: string, type: "income" | "expense") {
  if (dragName === dropName) return;

  setCategories((prev) => {
    // split into: this type + other type
    const sameType = prev.filter((c) => c.type === type);
    const otherType = prev.filter((c) => c.type !== type);

    const fromIndex = sameType.findIndex((c) => c.name === dragName);
    const toIndex = sameType.findIndex((c) => c.name === dropName);
    if (fromIndex < 0 || toIndex < 0) return prev;

    const copy = [...sameType];
    const [item] = copy.splice(fromIndex, 1);
    copy.splice(toIndex, 0, item);

    // recombine in a stable way: income first, expense second (or vice versa)
    const next =
      type === "income"
        ? [...copy, ...otherType]
        : [...otherType, ...copy];

    // persist order
    saveCategoryOrder(next);
    return next;
  });
}

  function autoScrollOnDrag(e: React.DragEvent, el: HTMLDivElement | null) {
  if (!el) return;

  e.preventDefault(); // IMPORTANT: allows dragover to keep firing

  const rect = el.getBoundingClientRect();
  const y = e.clientY;

  const edge = 40;
  const speed = 12;

  if (y < rect.top + edge) {
    el.scrollTop -= speed;
  } else if (y > rect.bottom - edge) {
    el.scrollTop += speed;
  }
}

useEffect(() => {
  if (authLoading) return;
  if (!user?.id) return;

  setUserId(user.id);
  setUserEmail(user.email ?? null);
}, [authLoading, user?.id]);


// ---- PICK WHICH TRANSACTIONS GO INTO THE PDF REPORT ----

useEffect(() => {
  setWindowDays((prev) => {
    // If user upgraded/downgraded, clamp to allowed values
    const allowed = isPro ? [7, 14, 30, 60, 90] : [7, 14, 30];
    if (allowed.includes(prev)) return prev; // keep user's choice
    return isPro ? 90 : 30; // fallback if prev isn't allowed
  });
}, [isPro]);

useEffect(() => {
  if (!user?.id) return;

  const upgraded = new URLSearchParams(window.location.search).get("upgraded");
  if (upgraded === "1") {
    loadProfile(user.id);

    // optional: clean the URL so it doesn't keep re-triggering
    const url = new URL(window.location.href);
    url.searchParams.delete("upgraded");
    window.history.replaceState({}, "", url.toString());
  }
}, [user?.id]);

function getReportTransactions(all: Transaction[]): Transaction[] {
  // helpers
  const parse = (s: string) => new Date(s + "T00:00:00");

  // this month = current calendar month
  if (reportRangeMode === "thisMonth") {
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-based
    return all.filter((t) => {
      const d = parse(t.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  // last month = full previous calendar month
  if (reportRangeMode === "lastMonth") {
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-based
    const lastMonthDate = new Date(year, month - 1, 1);
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth();

    return all.filter((t) => {
      const d = parse(t.date);
      return d.getFullYear() === lastYear && d.getMonth() === lastMonth;
    });
  }

  // "custom" / "current" / "lastNDays" all use periodStart / periodEnd
  const start = parse(periodStart);
  const end = parse(periodEnd);

  return all.filter((t) => {
    const d = parse(t.date);
    return d >= start && d <= end;
  });
}

// transactions actually used in the report
const reportTransactions = getReportTransactions(transactions);
const {
  income: reportIncome,
  expenses: reportExpenses,
  net: reportNet,
} = summarize(reportTransactions);

// label that appears next to the "Download report" button
function reportRangeLabel(): string {
  if (reportRangeMode === "thisMonth") return "This month";
  if (reportRangeMode === "lastMonth") return "Last month";

  if (reportRangeMode === "custom" && customStart && customEnd) {
    return `Custom: ${formatDate(customStart)} – ${formatDate(customEnd)}`;
  }

  // "current" or "lastNDays" -> whatever is on screen
  return `Current view (${periodLabel})`;
}

// ---- APPLY CUSTOM RANGE (PRO) ----

async function handleApplyCustomRange() {
  if (!customStart || !customEnd) {
    alert("Please choose both start and end dates.");
    return;
  }
  if (!isPro) {
  openUpgrade("Custom date ranges are Pro.");
  return;
  }

  // auto-swap if user picked backwards
  const start = customStart <= customEnd ? customStart : customEnd;
  const end = customStart <= customEnd ? customEnd : customStart;

  // OPTIONAL (recommended): clamp to plan window so Free can’t bypass
  // start must be >= windowStartStr, end must be <= todayStr
  const clampedStart = start < planWindowStartStr ? planWindowStartStr : start;

  
  const clampedEnd = end > todayStr ? todayStr : end;

  setAppliedStart(clampedStart);
  setAppliedEnd(clampedEnd);
  setRangeMode("custom");
  setReportRangeMode("custom");
}

// plan limit (independent of dropdown)
const planMaxDays = isPro ? 120 : 30;

const planWindowStartDate = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - (planMaxDays - 1)
);
const planWindowStartStr = toLocalISODate(planWindowStartDate);


function handleResetRange() {
  // Return to the normal mode (Last ${windowDays}, 60 days, etc.)
  setReportRangeMode("lastNDays");

  // Clear custom inputs
  setCustomStart("");
  setCustomEnd("");

  // Restore default time window
  setWindowDays(30);

  // Optionally — you can force refresh, but not needed:
  // setRefreshFlag(Math.random());
}


// ---- EFFECTIVE DATE RANGE FOR TRANSACTIONS ----
const effectiveStartDate =
  reportRangeMode === "custom" && customStart
    ? customStart
    : windowStartStr;

const effectiveEndDate =
  reportRangeMode === "custom" && customEnd
    ? customEnd
    : todayStr;

// ---- LOAD TRANSACTIONS FROM SUPABASE ----
  useEffect(() => {
  async function loadTransactions() {
    if (authLoading || !user) return;

    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", periodStart)
      .lte("date", periodEnd)
      .order("date", { ascending: false });

    if (error) {
      console.error("Error loading transactions:", error);
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    setTransactions((data ?? []) as Transaction[]);
    setLoading(false);
  }

  loadTransactions();
}, [authLoading, user, periodStart, periodEnd]);


//INSERT VARIABLE HERE?// const effectiveStartdate....

// ---- LOAD TRANSACTIONS FROM SUPABASE ----

// ---- LOGOUT ----
async function handleLogout() {
  await supabase.auth.signOut();
  router.push("/login");
}

  // ---- CATEGORY & ENTRY HANDLERS (LEFT BAR + CENTER) ----
  async function handleAddCategory(e: FormEvent) {
  e.preventDefault();

  const name = newCategoryName.trim();
  if (!name || !userId) return;

  // prevent duplicates in UI
  if (categories.some((c) => c.name === name)) {
    setNewCategoryName("");
    return;
  }

  // determine next sort index (append to bottom)
  const nextIndex =
    Math.max(...categories.map((c) => c.sort_index ?? 0), 0) + 1;

  // INSERT into Supabase
  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      name,
      type: newCategoryType,
      sort_index: nextIndex,
    })
    .select()
    .single();

  if (error) {
    console.error("Add category error:", error);
    setErrorMessage(error.message);
    return;
  }

  // Update React state with REAL DB row (includes id)
  setCategories((prev) => [...prev, data]);

  // Reset UI
  setNewCategoryName("");
  setNewCategoryType("expense");
}

async function saveCategoryOrder(ordered: Category[]) {
  if (!userId) return;

  const orderNames = ordered.map((c) => c.name);

  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, category_order: orderNames },
      { onConflict: "id" }
    );

  if (error) console.error("saveCategoryOrder error:", error.message);
}

async function handleAddCategoryEntry(e: FormEvent, categoryName: string) {
  e.preventDefault();
  setErrorMessage(null);

  if (!userId) {
    setErrorMessage("You must be logged in to add entries.");
    return;
  }

  const cat = categories.find((c) => c.name === categoryName);
  if (!cat) {
    setErrorMessage("Category not found.");
    return;
  }

  if (!formAmount || !formDate) {
    setErrorMessage("Please fill amount and date.");
    return;
  }

  const amountNumber = Number(formAmount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    setErrorMessage("Amount must be a positive number.");
    return;
  }

  // Compare dates safely (ignore time)
  const chosen = new Date(formDate + "T00:00:00");
  const start = new Date(String(periodStart).slice(0, 10) + "T00:00:00");
  const end = new Date();
  end.setHours(0, 0, 0, 0);

  if (chosen < start || chosen > end) {
    setErrorMessage(`Only last ${windowDays} days are allowed for your plan.`);
    return;
  }

  setSaving(true);

  const { data: inserted, error: insertError } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: cat.type,
      amount: amountNumber,
      date: formDate,
      category: categoryName,
      description: formDescription?.trim() ? formDescription.trim() : null,
    })
    .select("*")
    .single();

  if (insertError) {
    setErrorMessage(insertError.message);
    setSaving(false);
    return;
  }

  // Update UI without reloading everything
  if (inserted) {
    setTransactions((prev) => [inserted as Transaction, ...prev]);
  }

  setSaving(false);
  setFormAmount("");
  setFormDescription("");
  setExpandedCategory(null);
}

  // ---- QUICK ADD ----
  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!userId) {
      setErrorMessage("You must be logged in to add entries.");
      return;
    }

    if (!quickCategory) {
      setErrorMessage("Please choose a category.");
      return;
    }

    const cat = categories.find((c) => c.name === quickCategory);
    if (!cat) {
      // Optional: auto-select first category if something got out of sync
      if (categories.length > 0) {
        setQuickCategory(categories[0].name);
      }
      setErrorMessage("Category not found for Quick Add. Please pick a category again.");
      return;
    }

    if (!quickAmount || !quickDate) {
      setErrorMessage("Please fill amount and date.");
      return;
    }

    const amountNumber = Number(quickAmount);
    if (Number.isNaN(amountNumber) || amountNumber <= 0) {
      setErrorMessage("Amount must be a positive number.");
      return;
    }

    const chosen = new Date(quickDate);
    const periodStartDate = new Date(periodStart);

    if (chosen < periodStartDate || chosen > today) {
      setErrorMessage(`Only last ${windowDays} days are allowed for your plan.`);
      return;
    }

    setQuickSaving(true);

    try {
      // 1) INSERT (single insert, return inserted row id)
      const { data: insertedRows, error: insertError } = await supabase
        .from("transactions")
        .insert({
          user_id: userId,
          type: cat.type,
          amount: amountNumber,
          date: quickDate,
          category: cat.name,
          description: quickDescription || null,
        })
        .select("id")
        .limit(1);

      if (insertError) {
        setQuickAddStatus("error");
        setTimeout(() => setQuickAddStatus("idle"), 2000);
        setErrorMessage(insertError.message);
        return;
      }

      // ✅ SUCCESS UX
      setQuickAddStatus("added");
      setTimeout(() => setQuickAddStatus("idle"), 1200);

      const newId = insertedRows?.[0]?.id ?? null;

      // 2) RELOAD transactions for current period
      const { data, error: txError } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .gte("date", periodStart)
        .order("date", { ascending: false });

      if (txError) {
        setQuickAddStatus("error");
        setTimeout(() => setQuickAddStatus("idle"), 2000);
        setErrorMessage(txError.message);
        return;
      }

      setTransactions((data ?? []) as Transaction[]);

      // 3) Highlight new tx if we have id
      if (newId) {
        setHighlightedTxId(newId);
      }

      // 4) Clear fields
      setQuickAmount("");
      setQuickDescription("");
      setQuickDate(todayStr);
      // keep quickCategory so user can add multiple entries in same category
    } finally {
      setQuickSaving(false);
    }
  }




    function startEdit(t: Transaction) {
      setEditingId(t.id);
      setEditingAmount(String(t.amount));
      setEditingCategory(t.category);
      setEditingDate(t.date);
      setEditingDescription(t.description ?? "");
    }

   function cancelEdit() {
    setEditingId(null);
    setEditingAmount("");
    setEditingDate("");
    setEditingDescription("");
    setEditingSaving(false);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!editingId || !userId) return;

    if (!editingAmount || !editingDate) {
      setErrorMessage("Please fill amount and date.");
      return;
    }

    const amountNumber = Number(editingAmount);
    if (Number.isNaN(amountNumber) || amountNumber <= 0) {
      setErrorMessage("Amount must be a positive number.");
      return;
    }

    const chosen = new Date(editingDate);
   if (new Date(chosen) < new Date(periodStart) || new Date(chosen) > today) {
      setErrorMessage(`Only last ${windowDays} days are allowed for your plan.`);
      return;
    }

    setEditingSaving(true);

    const { error } = await supabase
      .from("transactions")
      .update({
        amount: amountNumber,
        date: editingDate,
        description: editingDescription || null,
      })
      .eq("id", editingId)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(error.message);
      setEditingSaving(false);
      return;
    }

    const { data, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", periodStart)
      .order("date", { ascending: false });

    if (txError) {
      setErrorMessage(txError.message);
    } else {
      setTransactions((data ?? []) as Transaction[]);
    }

    setEditingSaving(false);
    cancelEdit();
  }

  async function handleDeleteTransaction(id: string) {
    setErrorMessage(null);

    if (!userId) {
      setErrorMessage("You must be logged in to delete entries.");
      return;
    }

    const ok = window.confirm("Delete this entry? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const { data, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", periodStart)
      .order("date", { ascending: false });

    if (txError) {
      setErrorMessage(txError.message);
    } else {
      setTransactions((data ?? []) as Transaction[]);
    }
  }

      // ---- PRINT / PDF HANDLERS ----
  function openPrintDialog() {
    setPrintDialogOpen(true);
  }

  function closePrintDialog() {
    setPrintDialogOpen(false);
  }

  function handleConfirmPrint(e: FormEvent) {
    e.preventDefault();
    setPrintDialogOpen(false);
    if (typeof window !== "undefined") {
      window.print();
    }
  }

async function handleDeleteCategory(name: string) {
  const ok = window.confirm(
    `Delete category "${name}"? Transactions stay in history.`
  );
  if (!ok) return;

  if (!userId) {
    setErrorMessage("You must be logged in.");
    return;
  }

  // Find the row so we can delete by id (best + safest)
  const cat = categories.find((c) => c.name === name);

if (!cat) {
  setErrorMessage("Category not found in current list.");
  return;
}

setErrorMessage(null);

// If we have id, delete by id (best)
let del = supabase.from("categories").delete().eq("user_id", userId);

del = cat.id ? del.eq("id", cat.id) : del.eq("name", name); // ✅ fallback

const { error } = await del;
if (error) {
  console.error("Error deleting category:", error);
  setErrorMessage(error.message);
  return;
}

  setErrorMessage(null);

    // 2) Update UI state
 
const next = cat.id
  ? categories.filter((c) => c.id !== cat.id)
  : categories.filter((c) => c.name !== name);

  setCategories(next);

  if (selectedCategory === name) {
  setSelectedCategory(null);
   // prevent "Category id not found"
}

  
  if (expandedCategory === name) setExpandedCategory(null); setErrorMessage(null);

  // 3) Re-save order (optional but recommended)
  saveCategoryOrder(next);
}

function moveCategory(name: string, direction: "up" | "down") {
  setCategories((prev) => {
    const index = prev.findIndex((c) => c.name === name);
    if (index === -1) return prev;

    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= prev.length) return prev;

    const copy = [...prev];
    const [item] = copy.splice(index, 1);
    copy.splice(newIndex, 0, item);

    // ✅ persist order to Supabase
    saveCategoryOrder(copy);

    return copy;
  });
}

  // ---- DEFAULT DATES & QUICK CATEGORY ----
  useEffect(() => {
    if (!formDate) setFormDate(todayStr);
    if (!quickDate) setQuickDate(todayStr);
  }, [formDate, quickDate, todayStr]);

  useEffect(() => {
    if (categories.length === 0) return;

    const exists = categories.some((c) => c.name === quickCategory);

    if (!quickCategory || !exists) {
      setQuickCategory(categories[0].name);
    }
  }, [categories, quickCategory]);

  // ---- HIGHLIGHT TIMER ----
  useEffect(() => {
    if (!highlightedTxId) return;

    const timer = setTimeout(() => {
      setHighlightedTxId(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [highlightedTxId]);

    // ---- SET USER ID / EMAIL AND LOAD PROFILE (PLAN) ----

useEffect(() => {
  if (authLoading) return;
  if (!user) return;

  setUserEmail(user.email ?? null);
  setUserId(user.id);

  const userId = user.id;


  loadProfile(user.id);
}, [authLoading, user]);


// ---- LOAD CATEGORIES FOR THIS USER ----
useEffect(() => {
  // Wait for auth to finish
  if (authLoading) return;
  if (!user) return;

  // Capture a safe, stable user id
  const userId = user.id;

async function loadCategories() {
  if (!userId) return;

  // 1) get saved order from profile
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("category_order")
    .eq("id", userId)
    .single();

  if (profileErr) console.error("load profile order error:", profileErr.message);

  const savedOrder = (profile?.category_order as string[] | null) ?? null;

  // 2) get categories list
  const { data: cats, error: catsErr } = await supabase
    .from("categories")
    .select("name,type")
    .eq("user_id", userId);

  if (catsErr) {
    console.error("load categories error:", catsErr.message);
    return;
  }

  const normalized: Category[] = (cats ?? []).map((c: any) => ({
    name: c.name,
    type: c.type,
  }));

  // 3) apply saved order BEFORE setting state
  setCategories(applySavedOrder(normalized, savedOrder));
  setCategoriesLoaded(true);
}

function applySavedOrder(list: Category[], savedOrder: string[] | null) {
  if (!savedOrder || savedOrder.length === 0) return list;

  const pos = new Map(savedOrder.map((name, i) => [name, i]));

  return [...list].sort((a, b) => {
    const ai = pos.has(a.name) ? (pos.get(a.name) as number) : 999999;
    const bi = pos.has(b.name) ? (pos.get(b.name) as number) : 999999;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name); // stable fallback
  });
}


  loadCategories();
}, [authLoading, user]);

  // ---- DERIVED VALUES ----
  const { income, expenses, net } = summarize(transactions);

  let status: "OK" | "WARNING" | "DANGER" = "OK";
  if (net < 0) status = "DANGER";
  else if (net < 300) status = "WARNING";

  const spendingRatio = getSpendingRatio(income, expenses);
  const spentPct = Math.min(spendingRatio, 1) * 100;
  const remainingPct = 100 - spentPct;

  const categoryTransactions = selectedCategory
    ? transactions.filter((t) => t.category === selectedCategory)
    : [];

  const categoryTotal = categoryTransactions.reduce(
    (sum, t) =>
      sum +
      (t.type === "expense" ? -Number(t.amount) : Number(t.amount)),
    0
  );

  const savingsRate = income > 0 ? Math.round((net / income) * 100) : null;

  const expenseByCategory = transactions.reduce(
    (acc, t) => {
      if (t.type === "expense") {
        acc[t.category] = (acc[t.category] ?? 0) + Number(t.amount);
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const topCategories = Object.entries(expenseByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // ---- LOADING / REDIRECT ----
  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading your session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <p className="text-sm text-slate-300">Redirecting to login...</p>
      </main>
    );
  }

  // ---- MAIN LAYOUT ----
  return (
  <>
    {showUpgrade && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Unlock Pro</h3>
            <p className="text-sm text-slate-400 mt-1">
              {upgradeReason ?? "This feature is available on Pro."}
            </p>
          </div>
          <button
            onClick={closeUpgrade}
            className="rounded-md px-2 py-1 text-slate-300 hover:bg-slate-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Pro Plan</div>
              <div className="text-xs text-slate-400">
                120-day timeline • Custom ranges • PDF reports • Budgets insights
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold">{PRICING.monthly.label}</div>

              <div className="text-xs text-slate-400">per month. Cancel it anytime.</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={closeUpgrade}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm hover:bg-slate-800"
          >
            Not now
          </button>

          <button

            onClick={handleUpgrade}
            className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Unlock Pro
          </button>

        </div>

        <p className="text-[11px] text-slate-500">
          You can keep using Free mode (Last 30 days). Upgrade anytime.
        </p>
      </div>
    </div>
  </div>
)
}


    <main className="screen-only min-h-screen bg-slate-950 text-slate-100">
      
      {/* Print styling: keep dark dashboard look in PDF */}
      <style jsx global>{`
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .no-print {
            display: none !important;
          }

          .print-page {
            background: #020617 !important;
            padding: 4px !important; /* slate-950 */
          }

          .transactions-scroll,
          .budget-scroll {
            max-height: none !important;
            overflow: visible !important;
          }

          /* Budget status icons — subtle in PDF */
          .text-emerald-600,
          .text-amber-600,
          .text-rose-600 {
            filter: grayscale(15%);
          }
        }


      `}</style>

      {/* PRINT DIALOG (overlay) – only on screen, hidden in PDF */}
      {printDialogOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-5 shadow-2xl text-xs text-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Export as PDF</h2>
              <button
                type="button"
                onClick={closePrintDialog}
                className="text-slate-400 hover:text-slate-100 text-sm"
              >
            
              </button>
            </div>

            <p className="text-slate-300">
              This will print your current dashboard view. In your browser&apos;s
              print dialog choose{" "}
              <span className="font-semibold">&quot;Save as PDF&quot;</span>.
            </p>

            <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <p className="text-[11px] text-slate-300 font-medium mb-1">
                Time range
              </p>
              <p className="text-[11px] text-slate-400">
                The PDF uses the{" "}
                <span className="font-semibold">
                  Time ▸ Last {windowDays} days
                </span>{" "}
                selection in the top bar. Change that first if you want a
                different range.
              </p>
            </div>

            {isPro ? (
              <p className="text-[11px] text-emerald-300">
                Pro roadmap: next step we can add{" "}
                <span className="font-semibold">
                  This month / Last month / Custom
                </span>{" "}
                presets here.
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">
                Upgrade to Pro later to unlock richer PDF options like full
                monthly reports and custom ranges.
              </p>
            )}

            <form
              onSubmit={handleConfirmPrint}
              className="flex justify-end gap-2 pt-1"
            >
              <button
                type="button"
                onClick={closePrintDialog}
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
              >
                Print / Save as PDF
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="flex min-h-screen no-print">
        {/* ========================= */}
        {/* LEFT SIDEBAR             */}
        {/* ========================= */}
        <aside className="w-64 border-r border-slate-800 bg-slate-950/80 flex flex-col h-[calc(100vh-0px)]">
          <div className="px-4 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold tracking-wide">FlowTrack</h2>
            <p className="text-[11px] text-slate-400">
              See it. Measure it. Control it.
            </p>
          </div>

          <div className="flex-1 px-3 py-3 flex flex-col gap-3 text-xs overflow-y-auto">
            {/* CATEGORIES LIST */}
            {/* CATEGORIES LIST (SPLIT) */}
              <div className="flex flex-col gap-3 min-h-0">
                {/* INCOME (top 1/3) */}
                <div className="border border-slate-800 rounded-xl bg-slate-900/20 overflow-hidden">
                  <div className="text-slate-400 uppercase text-[10px] px-3 py-2 border-b border-slate-800">
                    Income
                  </div>

                    <div


                    ref={incomeScrollRef}
                    className="no-scrollbar max-h-[21vh] overflow-y-auto p-2 space-y-2"
                    onDragOver={(e) => {
                      e.preventDefault();
                      autoScrollOnDrag(e, incomeScrollRef.current);
                    }}
                    >
                                 
                    {categories
                      .filter((c) => c.type === "income")
                      .map((cat) => {
                        const isSelected = selectedCategory === cat.name;
                        const isExpanded = expandedCategory === cat.name;
                        const typeColor = "text-emerald-300";

                        return (
                          <div
                            key={cat.name}
                            className={`rounded-lg border ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-600/10"
                                : "border-slate-800 bg-slate-900"
                            }`}
                          >
                            <div
                              draggable
                            onDragStart={(e) => {
                              setDraggingName(cat.name);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDraggingName(null)}
                            
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!draggingName) return;
                              moveCategoryByDrag(draggingName, cat.name, "income");
                               setDraggingName(null);
                            }}


                            onDragEnter={(e) => e.preventDefault()}
                            onDragOver={(e) => e.preventDefault()}


                            className={`group w-full flex items-center justify-between px-3 py-1.5 text-[11px] rounded-t-lg cursor-move ${
                              isSelected ? "text-emerald-200" : "text-slate-200 hover:bg-slate-800"
                            } ${draggingName === cat.name ? "opacity-60" : ""}`}
                            
                            onClick={() => {
                              setSelectedCategory(cat.name);
                              setExpandedCategory(isExpanded ? null : cat.name);
                            }}
                                >

                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{cat.name}</span>
                                <span className={`text-[9px] uppercase tracking-wide ${typeColor}`}>
                                  Income
                                </span>
                              </div>

                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveCategory(cat.name, "up");
                                  }}
                                  className="text-slate-500 hover:text-slate-200 text-[10px]"
                                  aria-label={`Move ${cat.name} up`}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveCategory(cat.name, "down");
                                  }}
                                  className="text-slate-500 hover:text-slate-200 text-[10px]"
                                  aria-label={`Move ${cat.name} down`}
                                >
                                  ▼
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCategory(cat.name);
                                  }}
                                  className="ml-1 text-slate-500 hover:text-red-400 text-[10px]"
                                  aria-label={`Delete category ${cat.name}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <form
                                onSubmit={(e) => handleAddCategoryEntry(e, cat.name)}
                                className="px-3 pb-3 pt-2 border-t border-slate-800 space-y-2 text-[11px] no-print"
                              >
                                <div className="text-[10px] text-slate-400 mb-1">
                                  Add income entry
                                </div>

                                <div>
                                  <label className="block mb-1">Amount</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formAmount}
                                    onChange={(e) => setFormAmount(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                    placeholder="0.00"
                                  />
                                </div>

                                <div>
                                  <label className="block mb-1">
                                    Date{" "}
                                    <span className="text-[10px] text-slate-400">
                                      (last {windowDays} days)
                                    </span>
                                  </label>
                                  <input
                                    type="date"
                                    min={periodStart}
                                    max={periodEnd}
                                    value={formDate}
                                    onChange={(e) => setFormDate(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                  />
                                </div>

                                <div>
                                  <label className="block mb-1">Description (optional)</label>
                                  <input
                                    type="text"
                                    value={formDescription}
                                    onChange={(e) => setFormDescription(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                    placeholder="Short note..."
                                  />
                                </div>

                                <button
                                  type="submit"
                                  disabled={saving}
                                  className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed py-1.5 text-[11px] font-medium mt-1"
                                >
                                  {saving ? "Saving..." : `Add to "${cat.name}"`}
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })}
                   </div>
                </div>

                {/* EXPENSES (bottom 2/3) */}
                <div className="flex-1 min-h-0 border border-slate-800 rounded-xl bg-slate-900/20 overflow-hidden">
                  <div className="text-slate-400 uppercase text-[10px] px-3 py-2 border-b border-slate-800">
                    Expenses
                  </div>

                    <div
                      ref={expenseScrollRef}
                      className="no-scrollbar max-h-[49.5vh] overflow-y-auto p-2 space-y-2"
                      onDragOver={(e) => {
                        e.preventDefault();
                        autoScrollOnDrag(e, expenseScrollRef.current);
                      }}
                    >
                      {categories
                      .filter((c) => c.type === "expense")
                      .map((cat) => {
                        const isSelected = selectedCategory === cat.name;
                        const isExpanded = expandedCategory === cat.name;
                        const typeColor = "text-red-300";

                        return (
                          <div
                            key={cat.name}
                            className={`rounded-lg border ${
                              isSelected
                                ? "border-white-500 bg-red-600/10"
                                : "border-slate-800 bg-slate-900"
                            }`}
                          >
                            <div
                              draggable
                              onDragStart={(e) => {
                                setDraggingName(cat.name);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => setDraggingName(null)}
                              onDragOver={(e) => e.preventDefault()}
                              
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!draggingName) return;
                                moveCategoryByDrag(draggingName, cat.name, "expense");
                                setDraggingName(null);  
                              }}
                              
                              className={`group w-full flex items-center justify-between px-3 py-1.5 text-[11px] rounded-t-lg cursor-move ${
                                isSelected ? "text-red-200" : "text-slate-200 hover:bg-slate-800"
                              } ${draggingName === cat.name ? "opacity-60" : ""}`}
                              
                              onClick={() => {
                                if (draggingName) return;
                                setSelectedCategory(cat.name);
                                setExpandedCategory(isExpanded ? null : cat.name);
                              }}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{cat.name}</span>
                                <span className={`text-[9px] uppercase tracking-wide ${typeColor}`}>
                                  Expense
                                </span>
                              </div>

                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveCategory(cat.name, "up");
                                  }}
                                  className="text-slate-500 hover:text-slate-200 text-[10px]"
                                  aria-label={`Move ${cat.name} up`}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveCategory(cat.name, "down");
                                  }}
                                  className="text-slate-500 hover:text-slate-200 text-[10px]"
                                  aria-label={`Move ${cat.name} down`}
                                >
                                  ▼
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCategory(cat.name);
                                  }}
                                  className="ml-1 text-slate-500 hover:text-red-400 text-[10px]"
                                  aria-label={`Delete category ${cat.name}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <form
                                onSubmit={(e) => handleAddCategoryEntry(e, cat.name)}
                                className="px-3 pb-3 pt-2 border-t border-slate-800 space-y-2 text-[11px] no-print"
                              >
                                <div className="text-[10px] text-slate-400 mb-1">
                                  Add expense entry
                                </div>

                                <div>
                                  <label className="block mb-1">Amount</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formAmount}
                                    onChange={(e) => setFormAmount(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                    placeholder="0.00"
                                  />
                                </div>

                                <div>
                                  <label className="block mb-1">
                                    Date{" "}
                                    <span className="text-[10px] text-slate-400">
                                      (last {windowDays} days)
                                    </span>
                                  </label>
                                  <input
                                    type="date"
                                    min={periodStart}
                                    max={periodEnd}
                                    value={formDate}
                                    onChange={(e) => setFormDate(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                  />
                                </div>

                                <div>
                                  <label className="block mb-1">Description (optional)</label>
                                  <input
                                    type="text"
                                    value={formDescription}
                                    onChange={(e) => setFormDescription(e.target.value)}
                                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5"
                                    placeholder="Short note..."
                                  />
                                </div>

                                <button
                                  type="submit"
                                  disabled={saving}
                                  className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed py-1.5 text-[11px] font-medium mt-1"
                                >
                                  {saving ? "Saving..." : `Add to "${cat.name}"`}
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>


            {/* ADD CATEGORY FORM */}
            <form
              onSubmit={handleAddCategory}
              className="space-y-1 text-[11px] no-print"
            >
              <label className="block text-slate-400 px-1">Add category</label>
              <div className="flex flex-wrap gap-1">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1"
                  placeholder="e.g. Pets, Gym..."
                />
                <select
                  className="w-[90px] rounded-lg bg-slate-950 border border-slate-700 px-2 py-1"
                  value={newCategoryType}
                  onChange={(e) =>
                    setNewCategoryType(e.target.value as TransactionType)
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <button
                  type="submit"
                  className="px-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-medium"
                >
                  +
                </button>
              </div>
              <p className="text-[10px] text-slate-500 px-1">
                Each category is either Income or Expense.
              </p>
            </form>

            {/* LEFT SIDEBAR FOOTER */}
            <div className="mt-auto pt-3 border-t border-slate-800 no-print">
              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-300 text-[11px]"
              >
               
              </button>
            </div>

          </div>

          {/* LEFT SIDEBAR PLAN LABEL */}
   <div className="mt-4 space-y-1">
  <div className="text-slate-300">
    Plan: <span className="font-semibold text-yellow-300">{isPro ? "Pro" : "Free"}</span>
  </div>

  {isPro ? (
    <p className="text-emerald-300">
      Pro: tracking the last <span className="font-semibold">{windowDays}</span> days.
      <br />
      Reports coming soon.
    </p>
  ) : (
    <p className="text-slate-300">
      Free: tracking up to <span className="font-semibold">{windowDays}</span> days.
      Upgrade to unlock custom ranges and extended history.
    </p>
  )}

      <div className="mt-3">
      <a
      href="mailto:support@flowtrack.app?subject=FlowTrack Support"
      className="text-sm text-slate-400 hover:text-white underline"
    >
      Need help? Contact support
    </a>

  </div>
</div>

        </aside>

        {/* ========================= */}
        {/* CENTER AREA               */}
        {/* ========================= */}
        <section className="flex-1 flex flex-col">
          {/* TOP HORIZONTAL BAR / HEADER */}
          <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-950/80 mb-3">
            {/* Left side */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Live money session</span>
            </div>

            {/* Right side: Plan badge + Time + Print + Dark mode + User + Logout */}
            <div className="flex items-center gap-3 text-xs text-slate-200">
              {/* Plan badge */}
              <span
                className={
                  isPro
                    ? "px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500 text-[11px] uppercase tracking-wide text-emerald-300"
                    : "px-2 py-1 rounded-full bg-slate-800 border border-slate-600 text-[11px] uppercase tracking-wide text-slate-300"
                }
              >
                {isPro ? "PRO" : "FREE"}
              </span>

                {!isPro && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    Want custom ranges & up to 120 days?{" "}
                    <button
                      onClick={() => openUpgrade("Custom date ranges and extended history are Pro features.")}
                      className="text-emerald-400 hover:underline"
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                )}

              {/* Time selector + custom range (Pro) */}
                <div className="flex items-center gap-3">
                  {/* Quick presets */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Time:</span>
                    <select
                      className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs"
                      value={windowDays}
                      onChange={(e) => {
                        const newDays = Number(e.target.value);
                        
                        // 🔒 Free plan guard
                        if (!isPro && newDays > 30) {
                        openUpgrade("Time ranges above 30 days are Pro.");
                        return;
                         }

                        setReportRangeMode("lastNDays"); // keep this exactly as-is
                        setWindowDays(newDays);

                        // 🔓 RELEASE custom override
                        setRangeMode("preset");
                        setAppliedStart(null);
                        setAppliedEnd(null);
                      }}
                     >
                      {DAY_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          Last {days} days
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Custom range (Pro only) */}
                  {isPro && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-400">or Custom:</span>
                      <input
                        type="date"
                        
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
                      />
                      <span className="text-slate-500">to</span>          
                        
                        <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomRange}
                        className="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-[11px] font-medium"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>


              {/* Print / PDF button */}
              
                  <button
                    type="button"
                    onClick={handlePrintReport}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-medium"
                    >
                    Print / PDF
                    </button>

                    <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500 text-[11px] font-medium"
                    >
                    Log out
                  </button>

              {/* Dark Mode (placeholder) */}
              <button
                className="no-print px-3 py-1 rounded-full border border-slate-600 text-xs text-slate-300 cursor-not-allowed opacity-60"
                disabled
              >
                Dark mode
              </button>

              {/* Logged in user */}
              {userEmail && (
                <span className="px-2 py-1 rounded-full bg-slate-900 border border-slate-700">
                  Welcome,&nbsp;
                  <span className="font-semibold text-slate-50">
                    {userEmail}
                  </span>
                </span>
              )}

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="no-print px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500 text-[11px] font-medium"
              >
                Log out
              </button>
            </div>
          </header>

          {/* QUICK ADD BAR */}
          <div className="border-b border-slate-900 bg-slate-950/90 px-4 py-3 text-[11px] no-print">
            <form
              onSubmit={handleQuickAdd}
              className="flex flex-wrap items-center gap-2 md:gap-3"
            >
              <span className="text-slate-400 mr-1 whitespace-nowrap">
                Quick add:
              </span>

              {/* Category */}
              <select
                className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs min-w-[160px] focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                value={quickCategory}
                onChange={(e) => setQuickCategory(e.target.value)}
              >
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name} ({cat.type === "income" ? "Income" : "Expense"})
                  </option>
                ))}
              </select>

              {/* Amount */}
              <input
                type="number"
                min="0"
                step="0.01"
                value={quickAmount}
                onChange={(e) => setQuickAmount(e.target.value)}
                className="w-24 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="Amount"
              />

              {/* Date */}
              <input
                type="date"
                min={periodStart}
                max={periodEnd}
                value={quickDate}
                onChange={(e) => setQuickDate(e.target.value)}
                className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />

              {/* Note */}
              <input
                type="text"
                value={quickDescription}
                onChange={(e) => setQuickDescription(e.target.value)}
                className="flex-1 min-w-[140px] rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="Optional note"
              />

              {/* Button */}
              <button
                type="submit"
                disabled={quickSaving}
                className="rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-4 py-1.5 text-[11px] font-semibold tracking-wide transition-colors"
              >
                {quickSaving ? "Adding..." : "Add"}
              </button>
              {quickAddStatus === "added" && (
                    <span className="text-xs text-emerald-400 ml-2">Added ✓</span>
                  )}
                  {quickAddStatus === "error" && (
                    <span className="text-xs text-red-400 ml-2">Couldn’t add</span>
                  )}

            </form>
          </div>

          {/* ========================= */}
          {/* MAIN GRID (SUMMARY + LISTS) */}
          {/* ========================= */}
          <div className="flex-1 grid grid-rows-[minmax(0,0.18fr),minmax(0,0.82fr)] gap-4 p-4">
            {/* SUMMARY: INCOME / EXPENSES / NET */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
                <div>
                  
                 <h2 className="text-xs font-medium mb-1 text-slate-300">
                    Income{" "}
                    <span className="text-slate-500">
                      {activeRangeLabel}
                    </span>
                  </h2>
 

                  <p className="text-xl font-semibold">
                    {formatCurrency(income)}
                  </p>
                  {income === 0 && (
                    <div className="mt-1 text-xs text-slate-400">
                      No income yet — add your first income entry to get started.
                    </div>
                  )}

                </div>
              </div>

              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
                <div>
                  <h2 className="text-xs font-medium mb-1 text-slate-300">
                  Expenses{" "}
                  <span className="text-slate-500">
                    {activeRangeLabel}
                  </span>
                </h2>

                  <p className="text-xl font-semibold">
                    {formatCurrency(expenses)}
                  </p>

                  {expenses === 0 && (
                    <div className="mt-1 text-xs text-slate-400">
                      No expenses recorded — track spending to see where your money goes.
                    </div>
                  )}


                </div>
              </div>

              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
                <div>
                  
                  <h2 className="text-xs font-medium mb-1 text-slate-300">
                    Net{" "}
                    <span className="text-slate-500">
                      {activeRangeLabel}
                    </span>
                  </h2>

                  <p className="text-xl font-semibold">
                    {formatCurrency(net)}



                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Status:{" "}
                    <span
                      className={
                        status === "OK"
                          ? "text-emerald-400"
                          : status === "WARNING"
                          ? "text-amber-300"
                          : "text-red-400"
                      }
                    >
                      {status}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* BOTTOM: CATEGORY ENTRIES + ALL TRANSACTIONS */}
            <div className="grid md:grid-cols-2 gap-4 min-h-0">
              {/* CATEGORY ENTRIES CARD */}
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex flex-col min-h-0 max-h-[calc(82vh-6rem)]">
                <h2 className="text-sm font-medium mb-2">
                  Category Entries{" "}
                  <span className="text-slate-500 text-xs">
                    {activeRangeLabel}
                  </span>
                </h2>

                {errorMessage && (
                  <div className="mb-3 bg-red-500/10 border border-red-500 text-red-200 text-[11px] rounded-lg px-3 py-2">
                    {errorMessage}
                  </div>
                )}

                {!selectedCategory ? (
                  <p className="text-[11px] text-slate-400">
                    Select a category on the left and use its inline form or
                    Quick Add to add entries.
                  </p>
                ) : categoryTransactions.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    No entries in{" "}
                    <span className="font-semibold text-slate-200">
                      {selectedCategory}
                    </span>{" "}
                    for this range.
                  </p>

                ) : (
                  <>
                    <p className="text-[11px] text-slate-400">
                      Entries for{" "}
                      <span className="font-semibold text-slate-200">
                        {selectedCategory}
                      </span>{" "}
                      <span className="text-slate-500">
                        ({activeRangeLabel})
                      </span>
                    </p>

                    {/* CATEGORY TOTAL LINE */}
                    <p className="text-[11px] mt-1 mb-3">
                      Total:{" "}
                      <span
                        className={
                          categoryTotal < 0
                            ? "text-red-300 font-semibold"
                            : "text-emerald-300 font-semibold"
                        }
                      >
                        {categoryTotal < 0 ? "-$" : "$"}
                        {Math.abs(categoryTotal).toFixed(2)}
                      </span>
                    </p>

                    {editingId && (
                      <form
                        onSubmit={handleSaveEdit}
                        className="mb-3 p-2 rounded-lg border border-slate-700 bg-slate-950 space-y-2 text-[11px] no-print"
                      >
                        <div className="text-[10px] text-slate-400">
                          Editing entry
                        </div>

                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block mb-1">Amount</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingAmount}
                              onChange={(e) =>
                                setEditingAmount(e.target.value)
                              }
                              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block mb-1">
                              Date{" "}
                              <span className="text-[10px] text-slate-400">
                                (last {windowDays} days)
                              </span>
                            </label>
                            <input
                              type="date"
                              min={periodStart}
                              max={periodEnd}
                              value={editingDate}
                              onChange={(e) =>
                                setEditingDate(e.target.value)
                              }
                              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block mb-1">
                            Description (optional)
                          </label>
                          <input
                            type="text"
                            value={editingDescription}
                            onChange={(e) =>
                              setEditingDescription(e.target.value)
                            }
                            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5"
                          />
                        </div>

                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200 text-[11px]"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={editingSaving}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-[11px] font-medium"
                          >
                            {editingSaving ? "Saving..." : "Save changes"}
                          </button>
                        </div>
                      </form>
                    )}

                    <ul
                      ref={categoryListRef}
                      className="text-xs text-slate-200 space-y-2 overflow-auto pr-1 flex-1 transactions-scroll"
                    >
                      {categoryTransactions.map((t) => (
                        <li
                          key={t.id}
                          className={`flex items-center justify-between rounded-md px-2 py-1.5 border border-transparent ${
                            t.id === highlightedTxId
                              ? "bg-emerald-900/40 border-emerald-500/60"
                              : "hover:bg-slate-800/60 border-slate-800/80"
                          } transition-colors`}
                        >
                          <div>
                            <div className="font-medium">
                              {t.type === "income" ? "+" : "-"}
                              {formatCurrency(Number(t.amount))}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {formatDate(t.date)}
                              {t.description ? ` • ${t.description}` : ""}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 ml-2 no-print">
                            <button
                              type="button"
                              onClick={() => startEdit(t)}
                              className="px-2 py-1 rounded-md border border-slate-600 text-[10px] text-slate-200 hover:bg-slate-800 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTransaction(t.id)}
                              className="px-2 py-1 rounded-md border border-red-500/70 text-[10px] text-red-300 hover:bg-red-500/20 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* ALL TRANSACTIONS CARD */}
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex flex-col min-h-0 max-h-[calc(82vh-6rem)]">
                <h2 className="text-sm font-medium mb-3">
                  All transactions{" "}
                  <span className="text-slate-500 text-xs">
                    {activeRangeLabel}
                  </span>
                </h2>


                {transactions.length === 0 ? (
                  <p className="text-xs text-slate-300">
                    No transactions in this range.
                  </p>

                ) : (
                  <ul className="text-xs text-slate-200 space-y-2 overflow-auto pr-1 flex-1 transactions-scroll">
                    {transactions.map((t) => (
                      <li
                        key={t.id}
                        className={`flex items-center justify-between rounded-md px-2 py-1.5 border border-transparent ${
                          t.id === highlightedTxId
                            ? "bg-emerald-900/40 border-emerald-500/60"
                            : "hover:bg-slate-800/60 border-slate-800/80"
                        } transition-colors`}
                      >
                        <div>
                          <div className="font-medium">
                            {t.type === "income" ? "+" : "-"}
                            {formatCurrency(Number(t.amount))}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {t.category} • {formatDate(t.date)}
                            {t.description ? ` • ${t.description}` : ""}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteTransaction(t.id)}
                          className="no-print ml-2 px-2 py-1 rounded-md border border-red-500/70 text-[10px] text-red-300 hover:bg-red-500/20 transition-colors"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ========================= */}
        {/* RIGHT SIDEBAR             */}
        {/* ========================= */}
        <aside className="w-72 border-l border-slate-800 bg-slate-950/80 flex flex-col">
          <div className="px-4 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold">Preliminary report</h2>
            <p className="text-[11px] text-slate-400">
              Snapshot of your {activeRangeLabel}.
            </p>
          </div>

          <div className="flex-1 px-4 py-4 space-y-4 text-[11px] text-slate-300 overflow-auto">
            {/* OVERALL STATUS CARD */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
              <h3 className="font-medium mb-1 text-xs">Overall status</h3>
              <p>
                Your current status is{" "}
                <span
                  className={
                    status === "OK"
                      ? "text-emerald-400"
                      : status === "WARNING"
                      ? "text-amber-300"
                      : "text-red-400"
                  }
                >
                  {status}
                </span>
                .
              </p>
              <p className="mt-1 text-slate-400">
                Based on your net result over the {activeRangeLabel}:
              </p>
              <ul className="list-disc list-inside mt-1 space-y-1 text-slate-400">
                <li>Income: {formatCurrency(income)}</li>
                <li>Spending: {formatCurrency(expenses)}</li>
                <li>
                  Net:{" "}
                  <span
                    className={
                      net >= 0
                        ? "text-emerald-400 font-semibold"
                        : "text-red-400 font-semibold"
                    }
                  >
                    {formatCurrency(net)}
                  </span>
                </li>
              </ul>
            </div>

            {/* SAVINGS RATE CARD */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
              <h3 className="font-medium mb-1 text-xs">Savings rate</h3>
              {savingsRate === null ? (
                <p className="text-slate-400">
                  We couldn&apos;t calculate a savings rate yet. Add at least
                  one income and one expense entry.
                </p>
              ) : (
                <>
                  <p className="text-lg font-semibold mb-1">
                    {savingsRate}%
                  </p>

                  <p className="text-slate-400">
                    This is how much of your income you&apos;re keeping after
                    expenses in the last {activeRangeLabel} days.
                  </p>

                  <p className="mt-1 text-slate-400">
                    A simple reference for many young professionals is{" "}
                    <span className="text-emerald-300 font-medium">
                      10–20% saved
                    </span>
                    . This is not financial advice, just a reference point.
                  </p>
                </>
              )}
            </div>

            {/* TOP EXPENSE CATEGORIES CARD */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
              <h3 className="font-medium mb-1 text-xs">
                Where your money actually goes
              </h3>

              {topCategories.length === 0 ? (
                <p className="text-slate-400">
                  You haven&apos;t added any expenses yet. As you log spending,
                  we&apos;ll show your top categories here.
                </p>
              ) : (
                <>
                  <p className="text-slate-400 mb-2">
                    Biggest expense categories in the last {activeRangeLabel} days:
                  </p>
                  <ul className="space-y-1">
                    {topCategories.map(([catName, amount]) => (
                      <li
                        key={catName}
                        className="flex items-center justify-between"
                      >
                        <span className="truncate pr-2">{catName}</span>
                        <span className="font-medium">
                          {formatCurrency(amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-slate-400">
                    These are usually the best places to look first if you want
                    to free up money.
                  </p>
                </>
              )}
            </div>

            {/* BUDGET CARD */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
              <h3 className="font-medium mb-1 text-xs">Budgets (Monthly)</h3>
              <p className="text-slate-400 mb-2">
                Set a simple limit for your key categories. We&apos;ll show how
                much you&apos;ve used so far.
              </p>

              {/* Limited height so this area doesn't grow forever */}
              <div className="space-y-2 pr-1 max-h-56 overflow-y-auto budget-scroll">
                {categories.map((cat) => {
                  const budget = categoryBudgets[cat.name] ?? 0;
                  const spent = expenseByCategory[cat.name] ?? 0;
                  const pct = budget > 0 ? spent / budget : 0;
                  const status =
                    budget <= 0 ? "none" :
                    pct > 1 ? "over" :
                    pct >= 0.8 ? "near" :
                    "ok";

                  return (
                     <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="truncate pr-2 flex items-center gap-1">
                          <BudgetStatusIcon status={status} />
                          {cat.name}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={budget ? String(budget) : ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = val === "" ? 0 : Number(val);
                            setCategoryBudgets((prev) => ({
                              ...prev,
                              [cat.name]: Number.isNaN(num) ? 0 : num,
                            }));
                          }}
                          className="w-20 rounded-md bg-slate-950 border border-slate-700 px-1 py-0.5 text-right text-[10px]"
                          placeholder="Budget"
                        />
                      </div>

                      {budget > 0 && (
                        <>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${
                                pct < 80
                                  ? "bg-emerald-500"
                                  : pct < 100
                                  ? "bg-amber-400"
                                  : "bg-red-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>
                              {formatCurrency(spent)} /{" "}
                              {formatCurrency(budget)}
                            </span>
                            <span>{pct}% used</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="mt-2 text-[10px] text-slate-500">
                Tip: Start with just 3-5 key categories. Too many budgets =
                overwhelm.
              </p>
            </div>

            {/* PRO PLAN STATUS CARD */}
            <div className="bg-slate-900 rounded-lg border border-emerald-600/60 p-3">
              <h3 className="font-medium mb-1 text-xs text-emerald-300">
                {isPro ? "Pro plan active" : "Free plan"}
              </h3>

              {isPro ? (
                <>
                  <p className="text-slate-300">
                    You&apos;re currently using the{" "}
                    <span className="font-semibold text-amber-300">Pro</span>{" "}
                    plan.
                  </p>
                  <p className="mt-1 text-slate-400">
                    Tracking the last{" "}
                    <span className="font-semibold text-emerald-300">
                      {activeRangeLabel} days
                    </span>{" "}
                    of activity with advanced dashboards.
                  </p>
                  <p className="mt-1 text-slate-500">
                    More Pro features like reports and trends will appear here
                    as we build them.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-slate-300">
                    You&apos;re currently on the{" "}
                    <span className="font-semibold">Free</span> plan.
                  </p>
                  <p className="mt-1 text-slate-400">
                    Free tracks the last{" "}
                    <span className="font-semibold">{windowDays} days</span>{" "}
                    only.
                  </p>
                  <p className="mt-1 text-slate-500">
                    Upgrade to Pro to unlock a longer history window and richer
                    insights here.
                  </p>
                </>
              )}
            </div>

            {/* PIE CHART CARD */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 flex flex-col items-center mt-2">
              <div className="text-[11px] text-slate-400 mb-2">
                Spending vs income {activeRangeLabel}
              </div>

              <div className="relative flex items-center justify-center mb-3">
                <svg viewBox="0 0 36 36" className="w-24 h-24">
                  {/* Green ring = total income */}
                  <circle
                    className="text-emerald-500"
                    stroke="currentColor"
                    strokeWidth="7"
                    fill="none"
                    cx="18"
                    cy="18"
                    r="15.915"
                  />
                  {/* Red slice = spending portion */}
                  <circle
                    className="text-red-400"
                    stroke="currentColor"
                    strokeWidth="7"
                    strokeLinecap="butt"
                    fill="none"
                    cx="18"
                    cy="18"
                    r="15.915"
                    strokeDasharray={`${spentPct} ${remainingPct}`}
                    transform="rotate(-90 18 18)"
                  />
                </svg>
                <div className="absolute text-center">
                  <div className="text-xs font-semibold">
                    {income > 0
                      ? `${Math.round(Math.min(spendingRatio, 1) * 100)}%`
                      : "--"}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    of income used
                  </div>
                </div>
              </div>

              <div className="w-full flex justify-between text-[11px] mb-2">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Income</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span>Spending</span>
                </div>
              </div>

              <div className="w-full text-[11px] text-slate-300 space-y-1">
                <p>
                  Income:{" "}
                  <span className="font-semibold">
                    {formatCurrency(income)}
                  </span>
                </p>
                <p>
                  Spending:{" "}
                  <span className="font-semibold">
                    {formatCurrency(expenses)}
                  </span>
                </p>
                <p>
                  Net:{" "}
                  <span
                    className={
                      net >= 0
                        ? "text-emerald-400 font-semibold"
                        : "text-red-400 font-semibold"
                    }
                  >
                    {formatCurrency(net)}
                  </span>
                </p>
              </div>
            </div>
          </div>
          </aside>  {/* END RIGHT SIDEBAR */}
        </div>   {/* close flex wrapper */}
        
          
        {/* ============= PRINT-ONLY REPORT ============= */}
        
        
      <div className="print-page hidden print:block">
        <div className="print-report p-8 text-xs">
           <h1 className="text-lg font-semibold mb-1">FlowTrack Snapshot</h1>
            <p className="mb-4">
               Period: {periodLabel} • Generated on {formatDate(periodStart)}
            </p>
          {/* SUMMARY CARD (PRINT STYLE) */}
          <section className="print-card p-3 mb-4">
            <h2 className="font-semibold mb-2">Summary</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Income: {formatCurrency(income)}</li>
              <li>Expenses: {formatCurrency(expenses)}</li>
              <li>
                Net:{" "}
                <span className={net >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                  {formatCurrency(net)}
                </span>
              </li>
              {savingsRate !== null && (
                <li>Savings rate: {savingsRate}% of income kept after expenses</li>
              )}
            </ul>
          </section>
            </div>
                          
          {/* ===== TOP EXPENSE CATEGORIES ===== */}
          <section className="print-card p-3 mb-4">
            <h2 className="font-semibold mb-2">Top expense categories</h2>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Category</th>
                  <th className="text-right py-1">Spent</th>
                </tr>
              </thead>
              <tbody>
                {topCategories.map(([catName, amount]) => (
                  <tr key={catName} className="border-b last:border-0">
                    <td className="py-1">{catName}</td>
                    <td className="py-1 text-right">{formatCurrency(amount)}</td>
                  
                  </tr>
                ))}
              </tbody>
            </table>
          </section>


          {/* ==== FULL CATEGORY SPENDING TABLE (REPLACEMENT YOU ASKED FOR) ==== */}
          <section className="print-card p-3 mb-4">
            <h2 className="font-semibold mb-2">Categories</h2>
            <p className="text-[11px] mb-2 text-slate-600">
                    Range:{" "}
                    <span className="font-medium">
                      {activeRangeLabel}
                    </span>
            </p>

            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Category</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">Spent</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => {
                  const spent = transactions
                    .filter((t) => t.category === cat.name && t.type === "expense")
                    .reduce((acc, t) => acc + t.amount, 0);

                  return (
                    <tr key={cat.name} className="border-b last:border-0">
                      <td className="py-1">{cat.name}</td>
                      <td className="py-1">{cat.type === "income" ? "Income" : "Expense"}</td>
                      <td className="py-1 text-right">{spent > 0 ? formatCurrency(spent) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>


          {/* OPTIONAL: BUDGET STATUS (SHORT) */}
          <section className="print-card p-3">
          <h2 className="font-semibold mb-2">Budgets overview</h2>
          <p className="mb-2">
            Showing only categories that have a budget set.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-gray-300 text-left py-1 pr-2">
                  Category
                </th>
                <th className="border-b border-gray-300 text-right py-1 pr-2">
                  Spent
                </th>
                <th className="border-b border-gray-300 text-right py-1">
                  Budget
                </th>
              </tr>
            </thead>
            <tbody>
              {categories
                .filter((cat) => (categoryBudgets[cat.name] ?? 0) > 0)
                .map((cat) => {
                  const budget = categoryBudgets[cat.name] ?? 0;
                  const spent = expenseByCategory[cat.name] ?? 0;
                  return (
                    <tr key={cat.name}>
                      <td className="py-1 pr-2 border-b border-gray-200">
                        {cat.name}
                      </td>
                      <td className="py-1 text-right border-b border-gray-200">
                        {formatCurrency(spent)}
                      </td>
                      <td className="py-1 text-right border-b border-gray-200">
                        {formatCurrency(budget)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
           </table>
           <div>
            
           </div>
  </section>
<section className="no-print">

      {/* ALL CATEGORIES (PRINT STYLE) */}
      <section className="print-card p-3 mb-4">
        <h2 className="font-semibold mb-2">Categories</h2>
        <p className="mb-2 text-[11px]">
         All categories currently available in your FlowTrack workspace.
        </p>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left font-semibold">Category</th>
              <th className="py-1 text-left font-semibold">Type</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.name} className="border-b last:border-b-0">
                <td className="py-1">{cat.name}</td>
                <td className="py-1">
                  {cat.type === "income" ? "Income" : "Expense"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </section>
</div>

{/* =========== END PRINT-ONLY REPORT =========== */}

</main>
</>
);
}
