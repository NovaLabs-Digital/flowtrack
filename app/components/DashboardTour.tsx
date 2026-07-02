"use client";

import { useState, useEffect, useCallback } from "react";

// ── Step definitions ──────────────────────────────────────────────────────────

type Placement = "top" | "bottom" | "left" | "right";

interface TourStep {
  id: string;
  target: string | null; // [data-tour] attribute value; null = centered modal
  title: string;
  body: string;
  placement?: Placement;
  isWelcome?: boolean;
  isFinal?: boolean;
}

// Steps 0 (Welcome) + 1-9 (Tour) + 10 (Final) = 11 total
// "Step X of 9" label is shown for steps 1–9 only.
const STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Welcome to FlowTrack",
    body: "This quick tour will show you the main areas of your dashboard. It takes less than a minute.",
    isWelcome: true,
  },
  {
    id: "categories",
    target: "categories",
    title: "Categories",
    body: "Organize your income and expenses here. You can add, rename, and reorder categories anytime.",
    placement: "right",
  },
  {
    id: "quick-add",
    target: "quick-add",
    title: "Quick Add",
    body: "This is the fastest way to record income or expenses.",
    placement: "bottom",
  },
  {
    id: "date-range",
    target: "date-range",
    title: "Date Range",
    body: "Choose how much history you want to view. Pro users can access longer ranges and custom dates.",
    placement: "bottom",
  },
  {
    id: "summary-cards",
    target: "summary-cards",
    title: "Financial Overview",
    body: "These cards update automatically so you can see your income, spending, and net position at a glance.",
    placement: "bottom",
  },
  {
    id: "category-entries",
    target: "category-entries",
    title: "Category Entries",
    body: "Select a category to review and manage entries connected to it.",
    placement: "top",
  },
  {
    id: "transactions",
    target: "transactions",
    title: "Transaction History",
    body: "Every transaction you add appears here so you can review your financial activity over time.",
    placement: "top",
  },
  {
    id: "budgets",
    target: "budgets",
    title: "Budgets",
    body: "Set monthly limits for each category and track your progress.",
    placement: "left",
  },
  {
    id: "ai-coach",
    target: "ai-coach",
    title: "AI Financial Coach",
    body: "As you add transactions, FlowTrack provides personalized insights to help you understand your money.",
    placement: "left",
  },
  {
    id: "settings-btn",
    target: "settings-btn",
    title: "Settings",
    body: "Manage your account, subscription, billing, and preferences here.",
    placement: "right",
  },
  {
    id: "final",
    target: null,
    title: "You're ready",
    body: "Start by adding your first income or expense. FlowTrack will begin showing insights as your data grows.",
    isFinal: true,
  },
];

const TOUR_STEP_COUNT = STEPS.filter((s) => !s.isWelcome && !s.isFinal).length; // 9
const HIGHLIGHT_PAD = 6; // px of padding around the highlighted element
const TOOLTIP_W = 300; // px
const TOOLTIP_GAP = 14; // px gap between element edge and tooltip

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────
// Future extension points: onOpenChat, onOpenAI, onOpenTickets, onAttach

export interface DashboardTourProps {
  onComplete: () => void;
  onFocusQuickAdd?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardTour({ onComplete, onFocusQuickAdd }: DashboardTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: TOOLTIP_W, zIndex: 10001 });

  const step = STEPS[stepIndex];
  const tourStepNumber = step.isWelcome || step.isFinal ? null : stepIndex; // 1–9

  // ── Mobile detection ───────────────────────────────────────────────────────

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Measure target element ─────────────────────────────────────────────────

  const measureTarget = useCallback(() => {
    if (!step.target) { setTargetRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) { setTargetRect(null); return; }
    const r = el.getBoundingClientRect();
    setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right });
  }, [step.target]);

  useEffect(() => {
    measureTarget();
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [measureTarget]);

  // ── Tooltip position ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!targetRect || isMobile) {
      const vw = window.innerWidth;
      setTooltipStyle({
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        width: Math.min(TOOLTIP_W, vw - 32),
        zIndex: 10001,
      });
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedH = 180; // tooltip height estimate
    const w = Math.min(TOOLTIP_W, vw - 32);
    const placement = step.placement ?? "bottom";
    const { top, left, bottom, right, width, height } = targetRect;

    let tTop = 0;
    let tLeft = 0;

    if (placement === "bottom") {
      tTop = bottom + HIGHLIGHT_PAD + TOOLTIP_GAP;
      tLeft = left + width / 2 - w / 2;
    } else if (placement === "top") {
      tTop = top - HIGHLIGHT_PAD - TOOLTIP_GAP - estimatedH;
      tLeft = left + width / 2 - w / 2;
    } else if (placement === "right") {
      tTop = top + height / 2 - estimatedH / 2;
      tLeft = right + HIGHLIGHT_PAD + TOOLTIP_GAP;
    } else if (placement === "left") {
      tTop = top + height / 2 - estimatedH / 2;
      tLeft = left - HIGHLIGHT_PAD - TOOLTIP_GAP - w;
    }

    // Clamp to viewport
    tLeft = Math.max(8, Math.min(tLeft, vw - w - 8));
    tTop = Math.max(8, Math.min(tTop, vh - estimatedH - 8));

    setTooltipStyle({ position: "fixed", top: tTop, left: tLeft, width: w, zIndex: 10001 });
  }, [targetRect, step.placement, isMobile]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onComplete(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onComplete]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  function advance() {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      onComplete();
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  // True when no element is being highlighted (Welcome/Final or mobile or missing target)
  const isModal = !step.target || !targetRect || isMobile;
  const progressPct = ((stepIndex) / (STEPS.length - 1)) * 100;

  return (
    <>
      {/* ── Overlay / mask ──────────────────────────────────────────────── */}

      {isModal ? (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" style={{ zIndex: 10000 }} />
      ) : (
        <>
          {/* Four-rectangle cutout around target */}
          {/* Top */}
          <div
            className="fixed left-0 right-0 top-0 bg-slate-950/80"
            style={{ zIndex: 10000, height: Math.max(0, targetRect!.top - HIGHLIGHT_PAD) }}
          />
          {/* Bottom */}
          <div
            className="fixed left-0 right-0 bottom-0 bg-slate-950/80"
            style={{ zIndex: 10000, top: targetRect!.bottom + HIGHLIGHT_PAD }}
          />
          {/* Left */}
          <div
            className="fixed bg-slate-950/80"
            style={{
              zIndex: 10000,
              top: targetRect!.top - HIGHLIGHT_PAD,
              left: 0,
              width: Math.max(0, targetRect!.left - HIGHLIGHT_PAD),
              height: targetRect!.height + HIGHLIGHT_PAD * 2,
            }}
          />
          {/* Right */}
          <div
            className="fixed bg-slate-950/80"
            style={{
              zIndex: 10000,
              top: targetRect!.top - HIGHLIGHT_PAD,
              left: targetRect!.right + HIGHLIGHT_PAD,
              right: 0,
              height: targetRect!.height + HIGHLIGHT_PAD * 2,
            }}
          />
          {/* Emerald highlight ring */}
          <div
            className="fixed pointer-events-none rounded-xl"
            style={{
              zIndex: 10001,
              top: targetRect!.top - HIGHLIGHT_PAD,
              left: targetRect!.left - HIGHLIGHT_PAD,
              width: targetRect!.width + HIGHLIGHT_PAD * 2,
              height: targetRect!.height + HIGHLIGHT_PAD * 2,
              boxShadow: "0 0 0 2px rgba(52,211,153,0.8), 0 0 32px rgba(52,211,153,0.15)",
            }}
          />
        </>
      )}

      {/* ── Tooltip / modal card ─────────────────────────────────────────── */}

      <div
        style={tooltipStyle}
        className="rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
      >
        {/* Progress bar */}
        <div className="h-0.5 w-full overflow-hidden rounded-t-2xl bg-slate-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="p-5">
          {/* Step counter */}
          {tourStepNumber !== null && (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
              Step {tourStepNumber} of {TOUR_STEP_COUNT}
            </p>
          )}

          <h3 className="text-base font-semibold text-slate-100">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>

          {/* ── Welcome buttons ── */}
          {step.isWelcome && (
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={advance}
                className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-950"
              >
                Start Tour
              </button>
              <button
                type="button"
                onClick={onComplete}
                className="w-full rounded-xl border border-slate-700 py-2 text-sm text-slate-500 transition hover:bg-slate-800"
              >
                Skip Tour
              </button>
            </div>
          )}

          {/* ── Middle step buttons ── */}
          {!step.isWelcome && !step.isFinal && (
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={onComplete}
                className="text-xs text-slate-500 hover:text-slate-300 transition"
              >
                Skip Tour
              </button>
              <button
                type="button"
                onClick={advance}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {stepIndex === STEPS.length - 2 ? "Finish →" : "Next →"}
              </button>
            </div>
          )}

          {/* ── Final step buttons ── */}
          {step.isFinal && (
            <div className="mt-5 space-y-2">
              {onFocusQuickAdd && (
                <button
                  type="button"
                  onClick={() => { onComplete(); setTimeout(onFocusQuickAdd!, 50); }}
                  className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-950"
                >
                  Add My First Transaction
                </button>
              )}
              <button
                type="button"
                onClick={onComplete}
                className="w-full rounded-xl border border-slate-700 py-2 text-sm font-semibold text-slate-400 transition hover:bg-slate-800"
              >
                Finish
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
