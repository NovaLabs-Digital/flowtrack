// app/dashboard/page.tsx
"use client";

import { useEffect, useState, useMemo, FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseclient";
import { useAuth } from "@/app/context/AuthContext";
import { PRICING } from "@/lib/pricing";
import { generateFinancialReport } from "@/lib/financial-intelligence";
import type { FinancialReport } from "@/lib/financial-intelligence";
import HelpModal from "@/app/components/HelpModal";


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

function Sparkline({ data, color, height = 32, width = 100 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-20">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const pad = 2;
  const usable = height - pad * 2;

  const points = data
    .map((v, i) => `${i * step},${pad + usable - (v / max) * usable}`)
    .join(" ");

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polygon points={fillPoints} fill={color} opacity="0.08" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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


export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  
  const categoryListRef = useRef<HTMLUListElement | null>(null);
  const incomeScrollRef = useRef<HTMLDivElement | null>(null);
  const expenseScrollRef = useRef<HTMLDivElement | null>(null);
  
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [profile, setProfile] = useState<{
  plan: string;
  category_order: string[];
  stripe_subscription_status?: string | null;
  pro_grace_until?: string | null;
  dashboard_window_days?: number | null;
  } | null>(null);

  const isGraceActive =
  profile?.pro_grace_until &&
  new Date(profile.pro_grace_until) > new Date();

  const hasProAccess =
  profile?.plan === "pro" || isGraceActive;

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

  // auto-expire grace period
  const graceExpired =
    graceUntilRaw &&
    new Date(graceUntilRaw).getTime() < Date.now();

  const isPro =
  plan === "pro" &&
  !graceExpired &&
  (paidOk || inGrace || legacyPro);

 
  
    // ISO date string YYYY-MM-DD for Supabase filter

  // ---- TIME WINDOW (FREE vs PRO) ----
  const DAY_OPTIONS = isPro ? [7, 14, 30, 60, 90, 180] : [7, 14, 30];
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
          .select("plan, category_order, pro_grace_until, stripe_subscription_status, dashboard_window_days")
          .eq("id", userId)
          .maybeSingle();

        if (error) {
          console.error("Error loading profile:", error);
          setProfile({ plan: "free", category_order: [] });
          setProfileLoading(false);
          return;
        }

        // ---- SAFETY DOWNGRADE CHECK ----
        const graceExpired =
          data?.pro_grace_until &&
          new Date(data.pro_grace_until).getTime() < Date.now();

        const subscriptionInactive =
          data?.stripe_subscription_status &&
          data.stripe_subscription_status !== "active";

        if (
          data?.plan === "pro" &&
          graceExpired &&
          subscriptionInactive
        ) {
          console.log("Grace period expired — downgrading user");

          await supabase
            .from("profiles")
            .update({
              plan: "free",
              pro_grace_until: null,
            })
            .eq("id", userId);

          data.plan = "free";
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
          stripe_subscription_status: data.stripe_subscription_status ?? null,
          pro_grace_until: data.pro_grace_until ?? null,
          dashboard_window_days: data.dashboard_window_days ?? null,
        });

        // Restore saved window days preference, clamped to plan limits
        const savedDays = data.dashboard_window_days;
        if (savedDays) {
          const localGraceExpired =
            data.pro_grace_until &&
            new Date(data.pro_grace_until).getTime() < Date.now();
          const localIsPro =
            (data.plan ?? "free").toLowerCase() === "pro" && !localGraceExpired;
          const allowedDays = localIsPro
            ? [7, 14, 30, 60, 90, 180]
            : [7, 14, 30];
          if (allowedDays.includes(savedDays)) {
            setWindowDays(savedDays);
          }
        }

        setProfileLoading(false);
      }

    
      async function handleUpgrade() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          alert("Missing user session. Please log out and log in again.");
          return;
        }

        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
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
      if (!hasProAccess) {
        openUpgrade("Print / PDF reports are Pro.");
        return;
      }
      window.print();
    }


  // ---- USER & DATA STATE ----
  const [showHelp, setShowHelp] = useState(false);
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

const [checkingOnboarding, setCheckingOnboarding] = useState(true);

useEffect(() => {
  if (authLoading) return;
  if (!user?.id) return;

  setUserId(user.id);
  setUserEmail(user.email ?? null);
}, [authLoading, user?.id]);


// ---- PICK WHICH TRANSACTIONS GO INTO THE PDF REPORT ----

useEffect(() => {
  setWindowDays((prev) => {
    const allowed = isPro ? [7, 14, 30, 60, 90, 180] : [7, 14, 30];
    if (allowed.includes(prev)) return prev;
    return isPro ? 90 : 30;
  });
}, [isPro]);

async function saveWindowDays(days: number) {
  if (!userId) return;
  await supabase
    .from("profiles")
    .update({ dashboard_window_days: days })
    .eq("id", userId);
}

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


useEffect(() => {
  async function checkOnboardingStatus() {
    if (!user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("Failed to check onboarding status:", error);
      setCheckingOnboarding(false);
      return;
    }

    if (data && data.onboarding_completed === false) {
      router.push("/onboarding");
      return;
    }

    setCheckingOnboarding(false);
  }

  checkOnboardingStatus();
}, [user, router]);

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
  if (!hasProAccess) {
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
const planMaxDays = isPro ? 180 : 30;

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
    if (authLoading || !user?.id) return;

    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("transactions")
      .select("id, user_id, created_at, date, type, amount, category, description")
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
}, [authLoading, user?.id, periodStart, periodEnd]);


// ---- LOGOUT ----
async function handleLogout() {
  await supabase.auth.signOut();
  router.push("/login");
}
async function handleManageBilling() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert("Not logged in");
      return;
    }

    const res = await fetch("/api/stripe/portal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Unable to open billing portal");
      return;
    }

    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    alert("Something went wrong");
  }
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


useEffect(() => {
  const welcome = new URLSearchParams(window.location.search).get("welcome");

  if (welcome === "1") {
    setShowWelcomeBanner(true);

    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState({}, "", url.toString());
  }
}, []);

  // ---- DERIVED VALUES ----
  const { income, expenses, net } = summarize(transactions);

  const sparklineData = (() => {
    const incomeByDay: Record<string, number> = {};
    const expenseByDay: Record<string, number> = {};
    for (const t of transactions) {
      if (t.type === "income") incomeByDay[t.date] = (incomeByDay[t.date] ?? 0) + t.amount;
      else expenseByDay[t.date] = (expenseByDay[t.date] ?? 0) + t.amount;
    }
    const allDays = Array.from(new Set([...Object.keys(incomeByDay), ...Object.keys(expenseByDay)])).sort();
    let runningNet = 0;
    const incomeArr = allDays.map((d) => incomeByDay[d] ?? 0);
    const expenseArr = allDays.map((d) => expenseByDay[d] ?? 0);
    const netArr = allDays.map((d) => {
      runningNet += (incomeByDay[d] ?? 0) - (expenseByDay[d] ?? 0);
      return runningNet;
    });
    return { income: incomeArr, expense: expenseArr, net: netArr };
  })();

  const fieReport: FinancialReport | null = useMemo(() => {
    if (transactions.length === 0) return null;
    return generateFinancialReport(
      transactions.map((t) => ({
        id: t.id,
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
      })),
      categoryBudgets,
      periodStart,
      periodEnd
    );
  }, [transactions, categoryBudgets, periodStart, periodEnd]);

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

if (checkingOnboarding) {
  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
      <div className="text-center">
        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto" />

        <p className="text-sm text-slate-400">
          Loading FlowTrack...
        </p>
      </div>
    </main>
  );
}

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
                180-day timeline • Custom ranges • PDF reports • Budgets insights
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
                  <div className="text-slate-400 uppercase text-[10px] px-3 py-2 border-b border-slate-800 flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-emerald-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
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

                              <div className="min-w-0">
                                <span className="truncate">{cat.name}</span>
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
                  <div className="text-slate-400 uppercase text-[10px] px-3 py-2 border-b border-slate-800 flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-red-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
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
                              <div className="min-w-0">
                                <span className="truncate">{cat.name}</span>
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
              <label className="text-slate-400 px-1 flex items-center gap-1.5">
                <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                Add category
              </label>
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
            <div className="mt-auto pt-3 border-t border-slate-800 no-print space-y-0.5">
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-400 text-[11px] flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                Need Help?
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard/debt-recovery")}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-300 text-[11px] flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                Debt Recovery
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard/bill-guardian")}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-300 text-[11px] flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                Bill Guardian
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard/settings")}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-300 text-[11px] flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                Settings
              </button>
            </div>

          </div>

          {/* LEFT SIDEBAR PLAN LABEL */}
   <div className="mt-4 border-t border-white/5 px-4 pt-3 text-[11px] leading-relaxed text-slate-500">
  <p>
    Plan:{" "}
    <span className="font-medium text-slate-300">
      {isPro ? "Pro" : "Free"}
    </span>
  </p>

  <p className="mt-1">
    {isPro
      ? `Tracking ${windowDays} days history.`
      : `Tracking up to ${windowDays} days.`}
  </p>

  {!isPro && (
    <p className="mt-1">
      Upgrade for longer history.
    </p>
  )}

  <div className="mt-3">
    <a
      href="mailto:support@appflowtrack.com?subject=FlowTrack Support"
      className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1.5"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
      Contact support
    </a>
  </div>
</div>

        </aside>

        {/* ========================= */}
        {/* CENTER AREA               */}
        {/* ========================= */}
        <section className="flex-1 flex flex-col">
          {/* TOP HORIZONTAL BAR / HEADER */}
          <header className="min-h-14 border-b border-slate-800 flex flex-col gap-3 px-4 py-3 bg-slate-950/80 mb-3 xl:flex-row xl:items-center xl:justify-between">
            {/* Left side */}
            <div className="flex items-center gap-2 text-[11px] sm:text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Live money session</span>
            </div>

            {/* Right side: Plan badge + Time + Print + Dark mode + User + Logout */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs text-slate-200 xl:gap-3">
                          
              {/* Plan badge */}
              <span
                className={
                  isPro
                    ? "px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500 text-[11px] uppercase tracking-wide text-emerald-300"
                    : "px-2 py-1 rounded-full bg-slate-800 border border-slate-600 text-[11px] uppercase tracking-wide text-slate-300"
                }
              >
                {isPro
                    ? profile?.stripe_subscription_status === "past_due"
                      ? "PRO (Grace)"
                      : "PRO"
                    : "FREE"}
              
              </span>

              {!isPro && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    Want custom ranges & up to 180 days?{" "}
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

                        if (!isPro && newDays > 30) {
                          openUpgrade("Time ranges above 30 days are Pro.");
                          return;
                        }

                        setReportRangeMode("lastNDays");
                        setWindowDays(newDays);
                        setRangeMode("preset");
                        setAppliedStart(null);
                        setAppliedEnd(null);
                        saveWindowDays(newDays);
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

           {profile?.stripe_subscription_status === "past_due" && (
              <div className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <strong>Payment issue detected.</strong>{" "}
                    Please update your billing information to keep Pro access active.
                  </div>

                  <button
                    onClick={() => router.push("/dashboard/settings")}
                    className="rounded-lg border border-amber-400/50 px-3 py-1 text-xs hover:bg-amber-500/20"
                  >
                    Update billing
                  </button>
                </div>
              </div>
            )}

          {/* QUICK ADD BAR */}
          <div className="border-b border-slate-900 bg-slate-950/90 px-4 py-3 text-[11px] no-print">
            {showWelcomeBanner && (
              <div className="mb-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Welcome to FlowTrack 👋
                    </h2>

                    <p className="mt-1 text-sm text-emerald-100/80">
                      Your dashboard is now active. Add another real expense when ready.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowWelcomeBanner(false)}
                    className="rounded-lg border border-emerald-400/30 px-3 py-1 text-xs hover:bg-emerald-400/10"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

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
              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between overflow-hidden">
                <div>
                  <h2 className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1">
                    Income
                  </h2>
                  <p className="text-xl font-semibold text-emerald-400">
                    {formatCurrency(income)}
                  </p>
                  {income === 0 && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      No income yet.
                    </div>
                  )}
                </div>
                <div className="mt-2 -mx-1 -mb-1">
                  <Sparkline data={sparklineData.income} color="#34d399" width={180} height={28} />
                </div>
              </div>

              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between overflow-hidden">
                <div>
                  <h2 className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1">
                    Expenses
                  </h2>
                  <p className="text-xl font-semibold text-red-400">
                    {formatCurrency(expenses)}
                  </p>
                  {expenses === 0 && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      No expenses recorded.
                    </div>
                  )}
                </div>
                <div className="mt-2 -mx-1 -mb-1">
                  <Sparkline data={sparklineData.expense} color="#f87171" width={180} height={28} />
                </div>
              </div>

              <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col justify-between overflow-hidden">
                <div>
                  <h2 className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1">
                    Net
                  </h2>
                  <p className={`text-xl font-semibold ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatCurrency(net)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    <span className={status === "OK" ? "text-emerald-400" : status === "WARNING" ? "text-amber-300" : "text-red-400"}>
                      {status}
                    </span>
                  </p>
                </div>
                <div className="mt-2 -mx-1 -mb-1">
                  <Sparkline data={sparklineData.net} color={net >= 0 ? "#34d399" : "#f87171"} width={180} height={28} />
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
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 0-4 4c0 2 1 3 2 4l-5 8h14l-5-8c1-1 2-2 2-4a4 4 0 0 0-4-4z" />
                  <path d="M12 18v4" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold">AI Financial Coach</h2>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Personalized insights for your finances
            </p>
          </div>

          <div className="flex-1 px-3 py-3 space-y-3 text-[11px] text-slate-300 overflow-auto">

            {/* ── AI COACH CARDS ── */}

            {!fieReport ? (
              <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-5 text-center space-y-3">
                <div className="text-2xl">👋</div>
                <p className="text-slate-200 text-xs font-medium leading-relaxed">
                  Welcome to FlowTrack!
                </p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Add your first income or expense to unlock personalized financial insights.
                </p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  New here?{" "}
                  <button
                    type="button"
                    onClick={() => setShowHelp(true)}
                    className="text-emerald-400 hover:underline"
                  >
                    Contact Support
                  </button>
                  {" "}— we&apos;re happy to help.
                </p>
              </div>
            ) : fieReport.insights.length === 0 ? (
              <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-4 text-center">
                <p className="text-slate-500 text-xs leading-relaxed">
                  We&apos;re learning your spending habits. More insights will appear as your history grows.
                </p>
              </div>
            ) : (
              <>
                {/* TODAY'S INSIGHT — highest-priority positive insight */}
                {(() => {
                  const positive = fieReport.insights.find((i) =>
                    ["savings_win", "income_growth", "debt_opportunity", "monthly_summary"].includes(i.type)
                  );
                  const topInsight = positive ?? fieReport.insights[0];
                  return (
                    <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Today&apos;s Insight</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed font-medium mb-1">{topInsight.title}</p>
                      {topInsight.type === "savings_win" && (
                        <p className="text-slate-400 leading-relaxed">
                          Savings rate at <span className="font-semibold text-emerald-400">{(topInsight.payload.savingsRate as number)}%</span>.
                          {(topInsight.payload.savingsRate as number) >= 20
                            ? " Excellent discipline — you're ahead of most benchmarks."
                            : " Solid progress. Small cuts in top categories can push this higher."}
                        </p>
                      )}
                      {topInsight.type === "income_growth" && (
                        <p className="text-slate-400 leading-relaxed">
                          Income trending up <span className="font-semibold text-emerald-400">{(topInsight.payload.changePercent as number)}%</span> compared to earlier in this period.
                        </p>
                      )}
                      {topInsight.type === "debt_opportunity" && (
                        <p className="text-slate-400 leading-relaxed">
                          You have <span className="font-semibold text-emerald-400">{formatCurrency(topInsight.payload.discretionarySpending as number)}</span> in discretionary funds available this month.
                        </p>
                      )}
                      {topInsight.type === "monthly_summary" && (
                        <p className="text-slate-400 leading-relaxed">
                          Net savings of <span className={`font-semibold ${(topInsight.payload.netSavings as number) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(topInsight.payload.netSavings as number)}</span> with a{" "}
                          <span className="font-semibold">{(topInsight.payload.savingsRate as number)}%</span> savings rate.
                        </p>
                      )}
                      {!["savings_win", "income_growth", "debt_opportunity", "monthly_summary"].includes(topInsight.type) && (
                        <p className="text-slate-400 leading-relaxed">
                          Priority score: <span className="font-semibold">{topInsight.priority}</span>
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* SPENDING ALERT — highest-priority spending insight */}
                {(() => {
                  const alert = fieReport.insights.find((i) =>
                    ["spending_alert", "category_trend", "unusual_purchase", "budget_warning"].includes(i.type)
                  );
                  if (!alert) return null;
                  return (
                    <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Spending Alert</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed font-medium mb-1">{alert.title}</p>
                      {alert.type === "spending_alert" && typeof alert.payload.category === "string" && (
                        <>
                          <p className="text-slate-400 leading-relaxed">
                            <span className="font-semibold text-amber-300">{alert.payload.category as string}</span> accounts for{" "}
                            <span className="font-semibold">{alert.payload.percentOfTotal as number}%</span> of your total spending at{" "}
                            <span className="font-semibold">{formatCurrency(alert.payload.amount as number)}</span>.
                          </p>
                          {fieReport.income.total > 0 && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                                <div className="h-full bg-amber-400/80 rounded-full" style={{ width: `${Math.min((alert.payload.percentOfTotal as number), 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-500">{alert.payload.percentOfTotal as number}%</span>
                            </div>
                          )}
                        </>
                      )}
                      {alert.type === "spending_alert" && typeof alert.payload.direction === "string" && (
                        <p className="text-slate-400 leading-relaxed">
                          Overall spending up <span className="font-semibold text-amber-300">{alert.payload.changePercent as number}%</span>.
                          Avg monthly: <span className="font-semibold">{formatCurrency(alert.payload.avgMonthly as number)}</span>.
                        </p>
                      )}
                      {alert.type === "category_trend" && (
                        <p className="text-slate-400 leading-relaxed">
                          <span className="font-semibold text-amber-300">{alert.payload.category as string}</span> spending increased{" "}
                          <span className="font-semibold">{alert.payload.changePercent as number}%</span> compared to earlier in this period.
                        </p>
                      )}
                      {alert.type === "unusual_purchase" && (
                        <p className="text-slate-400 leading-relaxed">
                          Unusual expense of <span className="font-semibold text-amber-300">{formatCurrency(alert.payload.amount as number)}</span> in{" "}
                          <span className="font-semibold">{alert.payload.category as string}</span>.
                        </p>
                      )}
                      {alert.type === "budget_warning" && (
                        <p className="text-slate-400 leading-relaxed">
                          <span className="font-semibold text-amber-300">{alert.payload.category as string}</span> is at{" "}
                          <span className="font-semibold">{alert.payload.percentUsed as number}%</span> of budget ({formatCurrency(alert.payload.spent as number)} / {formatCurrency(alert.payload.budget as number)}).
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* SAVINGS GOAL — uses FIE savings data */}
                <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Savings Goal</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Savings rate</span>
                      <span className={`font-semibold ${fieReport.savings.savingsRate >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fieReport.savings.savingsRate}%
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Avg monthly savings</span>
                      <span className={`font-medium ${fieReport.savings.avgMonthlySavings >= 0 ? "text-slate-300" : "text-red-400"}`}>
                        {formatCurrency(fieReport.savings.avgMonthlySavings)}
                      </span>
                    </div>
                    {fieReport.savings.bestMonth && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">Best month</span>
                        <span className="text-slate-300">{fieReport.savings.bestMonth.month}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Trend</span>
                      <span className={`font-medium ${fieReport.savings.trend === "up" ? "text-emerald-400" : fieReport.savings.trend === "down" ? "text-red-400" : "text-slate-400"}`}>
                        {fieReport.savings.trend === "up" ? "Improving" : fieReport.savings.trend === "down" ? "Declining" : "Stable"}
                        {fieReport.savings.trendPercent > 0 && ` ${fieReport.savings.trendPercent}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 180-DAY FORECAST — uses FIE cash flow data */}
                <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Forecast</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Projected month-end</span>
                      <span className={`font-semibold ${fieReport.cashFlow.projectedMonthlyNet >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatCurrency(fieReport.cashFlow.projectedMonthlyNet)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Avg monthly cash flow</span>
                      <span className={`font-medium ${fieReport.cashFlow.avgMonthlyNet >= 0 ? "text-slate-300" : "text-red-400"}`}>
                        {formatCurrency(fieReport.cashFlow.avgMonthlyNet)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Discretionary spending</span>
                      <span className="font-medium text-slate-300">
                        {formatCurrency(fieReport.cashFlow.discretionarySpending)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Cash flow trend</span>
                      <span className={`font-medium ${fieReport.cashFlow.trend === "up" ? "text-emerald-400" : fieReport.cashFlow.trend === "down" ? "text-red-400" : "text-slate-400"}`}>
                        {fieReport.cashFlow.trend === "up" ? "Improving" : fieReport.cashFlow.trend === "down" ? "Declining" : "Stable"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── DIVIDER ── */}
            <div className="border-t border-slate-800/60 my-1" />

            {/* ── BUDGETS ── */}
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3">
              <h3 className="font-medium mb-2 text-xs">Monthly Budgets</h3>

              <div className="space-y-2 pr-1 max-h-56 overflow-y-auto budget-scroll">
                {categories.map((cat) => {
                  const budget = categoryBudgets[cat.name] ?? 0;
                  const spent = expenseByCategory[cat.name] ?? 0;
                  const pct = budget > 0 ? spent / budget : 0;
                  const budgetStatus =
                    budget <= 0 ? "none" :
                    pct > 1 ? "over" :
                    pct >= 0.8 ? "near" :
                    "ok";

                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="truncate pr-2 flex items-center gap-1">
                          <BudgetStatusIcon status={budgetStatus} />
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
                              className={`h-full rounded-full ${
                                pct < 0.8
                                  ? "bg-emerald-500"
                                  : pct < 1
                                  ? "bg-amber-400"
                                  : "bg-red-500"
                              }`}
                              style={{ width: `${Math.min(pct * 100, 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>
                              {formatCurrency(spent)} / {formatCurrency(budget)}
                            </span>
                            <span>{Math.round(pct * 100)}% used</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── DONUT CHART ── */}
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3 flex flex-col items-center">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-3">
                Spending vs Income
              </div>

              <div className="relative flex items-center justify-center mb-3">
                <svg viewBox="0 0 36 36" className="w-20 h-20">
                  <circle
                    className="text-emerald-500/30"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    cx="18"
                    cy="18"
                    r="15.915"
                  />
                  <circle
                    className="text-red-400"
                    stroke="currentColor"
                    strokeWidth="6"
                    strokeLinecap="round"
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
                  <div className="text-[9px] text-slate-500">used</div>
                </div>
              </div>

              <div className="w-full space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Income
                  </span>
                  <span className="font-medium">{formatCurrency(income)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    Spending
                  </span>
                  <span className="font-medium">{formatCurrency(expenses)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-800/60">
                  <span className="text-slate-400">Net</span>
                  <span className={`font-semibold ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatCurrency(net)}
                  </span>
                </div>
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

<HelpModal
  isOpen={showHelp}
  onClose={() => setShowHelp(false)}
  userEmail={userEmail ?? undefined}
  userId={userId ?? undefined}
  currentPage="Dashboard"
/>
</>
);
}
